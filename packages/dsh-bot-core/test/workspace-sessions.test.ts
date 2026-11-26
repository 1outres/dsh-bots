import { describe, expect, it } from "vitest"
import { workspaceSessionMenuActions } from "../src/client/workspace-sessions"
import { messageHeader } from "../src/host/channels/header"
import { workspaceRefusal } from "../src/host/managed/authority"
import { grantKey, type WorkspaceGrantRecord } from "../src/host/managed/domain"
import { createWorkspaceGrants } from "../src/host/managed/grants"
import { createGrantStore } from "../src/host/managed/grants-store"
import { workspaceOptions } from "../src/host/managed/options"
import { createManagedWaits } from "../src/host/managed/waits"
import { createWorkspaceSessions } from "../src/host/managed/workspace-session"
import { createSessionIdentity } from "../src/host/preset/identity"
import { createTurnParties, inputPartyOf, type TurnInput } from "../src/host/turns/parties"
import type { BotView } from "../src/shared/bots"
import type { BotManagedSession } from "../src/shared/managed-sessions"
import type { BotWorkspaceGrant, BotWorkspaceOptions } from "../src/shared/workspaces"
import { parseWorkspaceSettings, parseWorkspaceSettingsChange } from "../src/shared/workspaces"

function memoryTable<V>() {
  const map = new Map<string, V>()
  return {
    map,
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    put: async (key: string, value: V) => {
      map.set(key, value)
    },
    delete: async (key: string) => map.delete(key),
  }
}

const OPTIONS: BotWorkspaceOptions = {
  agentPresets: [{ id: "standard", isDefault: true }],
  permissions: [
    {
      id: "workspace-write",
      permission: { sandbox: "workspace-write", approval: "ask" },
      isDefault: true,
    },
  ],
}

const SETTINGS = {
  agentPreset: "standard",
  permission: { sandbox: "workspace-write", approval: "ask" },
  model: { kind: "profile-default" },
} as const

describe("what a Workspace grant can choose", () => {
  it("offers DSH's presets but no bot's and none that fails, and the configured permission presets but Auto", () => {
    const options = workspaceOptions({
      presets: [
        { id: "standard", name: "Standard" },
        { id: "bot-a" },
        { id: "creator", broken: "missing plugin" },
      ],
      defaultPreset: "standard",
      permissions: {
        names: ["workspace-write", "danger-full-access", "auto"],
        resolve: (name) =>
          name === "workspace-write"
            ? { sandbox: "workspace-write", approval: "ask" }
            : { sandbox: "danger-full-access", approval: name === "auto" ? "ask" : "never" },
        optionOf: (name) => ({ name: name.toUpperCase() }),
        defaultPreset: "workspace-write",
      },
    })
    expect(options.agentPresets).toEqual([{ id: "standard", name: "Standard", isDefault: true }])
    expect(options.permissions.map((option) => [option.id, option.name, option.isDefault])).toEqual(
      [
        ["workspace-write", "WORKSPACE-WRITE", true],
        ["danger-full-access", "DANGER-FULL-ACCESS", false],
      ],
    )
  })

  it("offers every pair of knobs where DSH has no permission presets", () => {
    const options = workspaceOptions({
      presets: [],
      defaultPreset: "standard",
      permissions: undefined,
    })
    expect(options.permissions).toHaveLength(6)
  })

  it("parses the owner's settings strictly", () => {
    expect(parseWorkspaceSettings(SETTINGS)).toEqual(SETTINGS)
    expect(() => parseWorkspaceSettings({ agentPreset: "standard" })).toThrow(
      "lack permission, model",
    )
    expect(() =>
      parseWorkspaceSettingsChange({ permission: { sandbox: "all", approval: "ask" } }),
    ).toThrow("permission.sandbox")
    expect(() => parseWorkspaceSettingsChange({ answerer: "main" })).toThrow("unknown fields")
  })
})

describe("Workspace grants", () => {
  const setup = () => {
    const table = memoryTable<WorkspaceGrantRecord>()
    const ended: string[] = []
    let workspaces = [
      { workspaceId: "w1", title: "Site", path: "/tmp/site" },
      { workspaceId: "w2", title: "Docs", path: "/tmp/docs" },
    ]
    const grants = createWorkspaceGrants({
      store: createGrantStore({ workspaceGrants: table }),
      exists: (botId) => botId === "a" || botId === "b",
      workspaces: () => workspaces,
      options: async () => OPTIONS,
      modelProblem: async (choice) => (choice.kind === "fixed" ? "no such model" : undefined),
      ended: async (grant, by) => {
        ended.push(`${grant.botId}/${grant.workspaceId} ${by}`)
      },
      now: () => 5,
    })
    return {
      table,
      grants,
      ended,
      removeWorkspace(id: string) {
        workspaces = workspaces.filter((workspace) => workspace.workspaceId !== id)
      },
    }
  }

  it("grants an existing Workspace once, with a preset, permission and model DSH offers", async () => {
    const { grants, table } = setup()
    await expect(grants.grant("a", "w9", SETTINGS)).rejects.toThrow('Workspace "w9" does not exist')
    await expect(grants.grant("a", "w1", { ...SETTINGS, agentPreset: "bot-b" })).rejects.toThrow(
      'agentPreset: "bot-b" is not an Agent preset',
    )
    await expect(
      grants.grant("a", "w1", {
        ...SETTINGS,
        permission: { sandbox: "danger-full-access", approval: "never" },
      }),
    ).rejects.toThrow("is not a permission mode of this DSH")
    await expect(
      grants.grant("a", "w1", { ...SETTINGS, model: { kind: "fixed", provider: "p", model: "x" } }),
    ).rejects.toThrow("model: no such model")
    await grants.grant("a", "w1", SETTINGS)
    await expect(grants.grant("a", "w1", SETTINGS)).rejects.toThrow("already granted")
    expect(table.map.get(grantKey("a", "w1"))).toEqual({
      botId: "a",
      workspaceId: "w1",
      ...SETTINGS,
      since: 5,
    })
    expect(grants.granted("a").map(({ workspace }) => workspace.title)).toEqual(["Site"])
  })

  it("changes a grant's settings, and ends the management of its sessions when it is revoked", async () => {
    const { grants, ended } = setup()
    await grants.grant("a", "w1", SETTINGS)
    await expect(grants.configure("a", "w2", {})).rejects.toThrow("not granted")
    await grants.configure("a", "w1", { agentPreset: "standard" })
    await grants.revoke("a", "w1")
    expect(ended).toEqual(["a/w1 revoked"])
    expect(grants.snapshot().grants).toEqual([])
  })

  it("drops the grants of a removed Workspace with a notice, and a deleted bot's silently", async () => {
    const { grants, ended, removeWorkspace } = setup()
    await grants.grant("a", "w1", SETTINGS)
    await grants.grant("a", "w2", SETTINGS)
    await grants.grant("b", "w2", SETTINGS)
    removeWorkspace("w1")
    await grants.reconcile()
    await grants.purge((botId) => botId === "a")
    expect(ended).toEqual(["a/w1 workspace-removed"])
    expect(grants.snapshot().grants.map((grant) => `${grant.botId}/${grant.workspaceId}`)).toEqual([
      "a/w2",
    ])
  })
})

describe("starting a Workspace session", () => {
  const grant: BotWorkspaceGrant = { botId: "a", workspaceId: "w1", ...SETTINGS, since: 1 }
  const setup = (agentPreset: string | undefined = "standard") => {
    const done: string[] = []
    const creator = createWorkspaceSessions<{ id: string }>({
      async model(choice) {
        if (choice.kind === "profile-default") return { kind: "profile-default" }
        return { kind: "fixed", selection: { provider: choice.provider, model: choice.model } }
      },
      async create(request) {
        done.push(`create ${request.workspaceId} ${request.agentPreset}`)
        return { sessionId: "ws1", agentPreset }
      },
      session: (sessionId) => ({ id: sessionId }),
      permit: (session, granted) =>
        done.push(
          `permit ${session.id} ${granted.permission.sandbox}/${granted.permission.approval}`,
        ),
      select: (sessionId, model) => done.push(`select ${sessionId} ${model.selection.model}`),
      async rename(sessionId, title) {
        done.push(`rename ${sessionId} ${title}`)
      },
      async discard(sessionId) {
        done.push(`discard ${sessionId}`)
      },
      warn: () => {},
    })
    return { creator, done }
  }

  it("makes a DSH session in the Workspace under the grant, sets its permission and model, and records no bot session", async () => {
    const { creator, done } = setup()
    await creator.create(grant, {
      title: "Fix",
      model: { kind: "fixed", provider: "p", model: "big" },
    })
    await creator.create(grant, { title: "Fix", model: { kind: "profile-default" } })
    expect(done).toEqual([
      "create w1 standard",
      "permit ws1 workspace-write/ask",
      "select ws1 big",
      "rename ws1 Fix",
      "create w1 standard",
      "permit ws1 workspace-write/ask",
      "rename ws1 Fix",
    ])
  })

  it("archives a session that does not run the grant's preset", async () => {
    const { creator, done } = setup("other")
    await expect(creator.create(grant, { title: "Fix", model: SETTINGS.model })).rejects.toThrow(
      'runs Agent preset "other" instead of "standard"',
    )
    expect(done).toEqual(["create w1 standard", "discard ws1"])
  })

  it("stays a Workspace session to bot-core's isolation: its identity names no bot", () => {
    const identity = createSessionIdentity<{
      id: string
      session: { header: { agentPreset?: string } }
    }>({ isBot: (botId) => botId === "a", recorded: () => undefined, agent: () => undefined })
    expect(identity({ id: "ws1", session: { header: { agentPreset: "standard" } } })).toEqual({
      kind: "none",
    })
  })
})

const ownerSide = (input: TurnInput) => {
  const party = inputPartyOf(input)
  return party !== "other" && party !== "peer"
}

describe("who a Main turn listens to", () => {
  const text = (value: string, source: TurnInput["source"] = { kind: "user" }): TurnInput => ({
    content: [{ type: "text", text: value }],
    source,
  })

  it("counts the owner, the owner's channel messages and bot-core's notices as the owner's side", () => {
    expect(ownerSide(text("hi"))).toBe(true)
    expect(ownerSide(text("[Discord · DM · Ann (@ann, owner)]\nhi"))).toBe(true)
    expect(ownerSide(text("[session] done", { kind: "bot-session" }))).toBe(true)
    expect(ownerSide(text("[Discord · DM · Bob (@bob)]\ndo it"))).toBe(false)
    expect(ownerSide(text("hi", { kind: "user", principal: { kind: "peer" } }))).toBe(false)
    expect(ownerSide(text("mail", { kind: "bot-connector-event" }))).toBe(false)
  })

  it("reads the header bot-core writes on channel messages", () => {
    const header = (owner: boolean, bot = false) =>
      messageHeader({
        channel: "Discord",
        place: { kind: "direct" },
        sender: { id: "1", displayName: "Ann (owner)", handle: "ann, owner", bot },
        owner,
      })
    expect(ownerSide(text(`${header(true)}\nfix the site`))).toBe(true)
    expect(ownerSide(text(`${header(false)}\nfix the site`))).toBe(false)
    expect(ownerSide(text(`${header(false, true)}\nfix the site`))).toBe(false)
  })

  it("refuses a turn once someone else's message enters it, until it ends; and a turn it did not see start", () => {
    const parties = createTurnParties({ tracked: (sessionId) => sessionId === "m" })
    const authority = {
      sessionEvent: parties.sessionEvent,
      refusal: (sessionId: string) => workspaceRefusal(parties.current(sessionId)),
    }
    const event = (type: string, data: unknown) => ({ type, data })
    expect(authority.refusal("m")).toMatch("saw start")
    authority.sessionEvent("m", event("turn/start", { turn: 1 }))
    authority.sessionEvent("m", event("user/message", text("hi")))
    expect(authority.refusal("m")).toBeUndefined()
    authority.sessionEvent("m", event("user/message", text("[Discord · DM · Bob (@bob)]\nx")))
    expect(authority.refusal("m")).toMatch("someone other than your owner")
    authority.sessionEvent("m", event("turn/end", { turn: 1 }))
    authority.sessionEvent("m", event("turn/start", { turn: 2 }))
    expect(authority.refusal("m")).toBeUndefined()
    authority.sessionEvent("s", event("turn/start", { turn: 1 }))
    expect(authority.refusal("s")).toMatch("saw start")
  })
})

describe("what waits in DSH's own UI", () => {
  const managed: BotManagedSession = {
    botId: "a",
    sessionId: "ws1",
    target: { kind: "workspace", workspaceId: "w1" },
    answerer: "owner",
    origin: "main",
    since: 1,
  }

  it("follows a question or approval of a managed Workspace session until DSH settles it, and passes others on", async () => {
    const opened: string[] = []
    const waits = createManagedWaits<{ id: string }>({
      managedOf: (agent) => (agent.id === "ws1" ? managed : undefined),
      opened: (session, wait) => opened.push(`${session.sessionId} ${wait.kind} ${wait.summary}`),
      newId: () => "d1",
    })
    let settle: (value: { answers: [] }) => void = () => {}
    const answered = waits.question(
      { agent: { id: "ws1" }, questions: [{ id: "q", question: "Which?" }] },
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    expect(waits.openIn("ws1")).toEqual([{ id: "d1", kind: "question", summary: "Which?" }])
    settle({ answers: [] })
    await answered
    expect(waits.openIn("ws1")).toEqual([])
    await expect(
      waits.approval(
        { agent: { id: "ws1" }, toolName: "bash", reason: "rm" },
        async () => "rejected",
      ),
    ).resolves.toBe("rejected")
    await waits.approval({ agent: { id: "other" }, toolName: "bash" }, async () => "allowed-once")
    expect(opened).toEqual(["ws1 question Which?", "ws1 approval bash: rm"])
  })
})

describe("the Workspace session menu", () => {
  const bot = (id: string, name: string) => ({ id, name }) as BotView
  const grants = {
    grants: [
      {
        botId: "a",
        workspaceId: "w1",
        agentPreset: "standard",
        permission: { sandbox: "workspace-write", approval: "ask" },
        model: { kind: "profile-default" },
        since: 1,
      },
    ],
    workspaces: [{ workspaceId: "w1", title: "Site", path: "/tmp/site" }],
  } as const
  const done: string[] = []
  const actions = {
    entrust: (botId: string, sessionId: string) => done.push(`entrust ${botId} ${sessionId}`),
    release: (botId: string, sessionId: string) => done.push(`release ${botId} ${sessionId}`),
    setAnswerer: (botId: string, sessionId: string, answerer: string) =>
      done.push(`answerer ${botId} ${sessionId} ${answerer}`),
  }
  const t = (key: string, params?: Record<string, unknown>) =>
    params?.bot === undefined ? key : `${key}(${String(params.bot)})`
  const menu = (overrides: Partial<Parameters<typeof workspaceSessionMenuActions>[0]>) =>
    workspaceSessionMenuActions({
      sessionId: "ws1",
      workspaceId: "w1",
      archived: false,
      bots: [bot("a", "Ada"), bot("b", "Bea")],
      grants,
      managed: undefined,
      actions,
      t,
      ...overrides,
    })

  it("offers to hand an unmanaged session to the bots its Workspace is granted to", () => {
    const [entrust] = menu({})
    expect(entrust?.label).toBe("workspaceSession.entrust")
    expect(entrust?.children?.map((child) => child.label)).toEqual(["Ada"])
    entrust?.children?.[0]?.run?.()
    expect(done.at(-1)).toBe("entrust a ws1")
    expect(menu({ archived: true })).toEqual([])
    expect(menu({ workspaceId: "w2" })).toEqual([])
    expect(menu({ grants: undefined })).toEqual([])
  })

  it("offers the other answerer and taking it back for a managed one", () => {
    const actionsOf = menu({
      managed: {
        botId: "a",
        sessionId: "ws1",
        target: { kind: "workspace", workspaceId: "w1" },
        answerer: "owner",
        origin: "owner",
        since: 1,
      },
    })
    expect(actionsOf.map((action) => action.label)).toEqual([
      "workspaceSession.answerer.main(Ada)",
      "workspaceSession.release(Ada)",
    ])
    actionsOf[0]?.run?.()
    actionsOf[1]?.run?.()
    expect(done.slice(-2)).toEqual(["answerer a ws1 main", "release a ws1"])
  })
})
