import { describe, expect, it } from "vitest"
import type { BotSessionModelRequest } from "../src/contract"
import type { ManagedSessionRecord } from "../src/host/managed/domain"
import { createManagedFollow } from "../src/host/managed/follow"
import type { MainMessage } from "../src/host/managed/messages"
import { type SessionNoticeEvent, sessionNotice } from "../src/host/managed/notice"
import { createManagedPanel } from "../src/host/managed/panel"
import { createManagedSessions } from "../src/host/managed/sessions"
import { createManagedStore } from "../src/host/managed/store"
import { createManagedTools } from "../src/host/managed/tools"
import { renderTranscript, transcriptOf } from "../src/host/managed/transcript"
import type { DshWait } from "../src/host/managed/waits"
import { delegateNamed, isDelegate, modelIdOf } from "../src/host/models/delegates"
import type { TranscriptMessage } from "../src/host/spoken-messages"
import type { BotInteraction, BotInteractionAnswer } from "../src/shared/interactions"
import type { BotManagedSession } from "../src/shared/managed-sessions"
import type { BotModelChoice } from "../src/shared/models"
import type { BotWorkspaceGrant } from "../src/shared/workspaces"

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

/**
 * Bot "a": Main "m", sessions "s1", "s2", "run" (a schedule run's) and "old" (archived); bot "b": "t1".
 * DSH Workspace "w1" (granted to "a") holds "ws1", "ws2"; "w2" (granted to nobody) holds "ws3".
 */
function world() {
  const table = memoryTable<ManagedSessionRecord>()
  const ended: string[] = []
  let now = 10
  const owners: Record<string, string> = {
    m: "a",
    m0: "a",
    s1: "a",
    s2: "a",
    run: "a",
    old: "a",
    t1: "b",
  }
  const members: Record<string, string> = { ws1: "w1", ws2: "w1", ws3: "w2" }
  const grants = new Set(["a/w1"])
  const sessions = createManagedSessions({
    store: createManagedStore({ managedSessions: table }),
    botOfSession: (sessionId) => owners[sessionId],
    workspaceOfSession: (sessionId) => members[sessionId],
    granted: (botId, workspaceId) => grants.has(`${botId}/${workspaceId}`),
    mainOf: (botId) => (botId === "a" ? "m" : undefined),
    pastMain: (sessionId) => sessionId === "m0",
    isScheduleRun: (sessionId) => sessionId === "run",
    archived: (sessionId) => sessionId === "old",
    ended: async (session, by) => {
      ended.push(`${session.sessionId} ${by}`)
    },
    now: () => (now += 1),
  })
  return { table, sessions, ended, grants }
}

describe("managed sessions", () => {
  it("manages only the bot's own sessions besides its Main, a schedule run's and archived ones", () => {
    const { sessions } = world()
    const problem = (botId: string, sessionId: string) => {
      const found = sessions.targetOf(botId, sessionId)
      return "problem" in found ? found.problem : undefined
    }
    expect(sessions.targetOf("a", "s1")).toEqual({ target: { kind: "bot" } })
    expect(problem("a", "m")).toMatch("Main session")
    expect(problem("a", "m0")).toMatch("former Main")
    expect(problem("a", "run")).toMatch("scheduled run")
    expect(problem("a", "old")).toMatch("archived")
    expect(problem("a", "t1")).toMatch("not a session of this bot")
  })

  it("manages a DSH Workspace's session only for a bot the Workspace is granted to", () => {
    const { sessions } = world()
    const problem = (botId: string, sessionId: string) => {
      const found = sessions.targetOf(botId, sessionId)
      return "problem" in found ? found.problem : undefined
    }
    expect(sessions.targetOf("a", "ws1")).toEqual({
      target: { kind: "workspace", workspaceId: "w1" },
    })
    expect(problem("b", "ws1")).toMatch('Workspace "w1" is not granted to this bot')
    expect(problem("a", "ws3")).toMatch('Workspace "w2" is not granted')
    expect(problem("a", "elsewhere")).toMatch("neither a session of this bot nor")
  })

  it("hands a Workspace session over with the owner answering, and ends it when the grant goes", async () => {
    const { sessions, ended } = world()
    await expect(sessions.entrust("a", "ws1")).resolves.toMatchObject({
      target: { kind: "workspace", workspaceId: "w1" },
      answerer: "owner",
      origin: "owner",
    })
    await expect(sessions.entrust("b", "ws1")).rejects.toThrow("not granted")
    await expect(
      sessions.start("a", "s2", {
        target: { kind: "workspace", workspaceId: "w1" },
        answerer: "owner",
        label: "x",
      }),
    ).rejects.toThrow("does not run where it was started for")
    await sessions.start("a", "ws2", {
      target: { kind: "workspace", workspaceId: "w1" },
      answerer: "main",
      label: "Fix",
    })
    await sessions.entrust("a", "s1")
    await sessions.grantEnded("a", "w1", "revoked")
    expect(ended).toEqual(["ws1 revoked", "ws2 revoked"])
    expect(sessions.list().map((session) => session.sessionId)).toEqual(["s1"])
  })

  it("hands a session over with the target's default answerer and tells the Main when the owner takes it back", async () => {
    const { sessions, ended } = world()
    const entrusted = await sessions.entrust("a", "s1")
    expect(entrusted).toEqual({
      botId: "a",
      sessionId: "s1",
      target: { kind: "bot" },
      answerer: "main",
      origin: "owner",
      since: 11,
    })
    await expect(sessions.entrust("a", "s1")).rejects.toThrow("already managed")
    await expect(sessions.setAnswerer("a", "s1", "owner")).resolves.toMatchObject({
      answerer: "owner",
    })
    await expect(sessions.setAnswerer("b", "s1", "main")).rejects.toThrow("not managed")
    await sessions.release("a", "s1", "owner")
    expect(ended).toEqual(["s1 owner"])
    expect(sessions.get("s1")).toBeUndefined()
  })

  it("does not tell the Main of its own release, and ends a management when the session is archived", async () => {
    const { sessions, ended } = world()
    await sessions.start("a", "s1", { target: { kind: "bot" }, answerer: "owner", label: "Task" })
    await sessions.entrust("a", "s2")
    await sessions.release("a", "s1", "main")
    await sessions.archived("s2")
    await sessions.archived("s2")
    expect(ended).toEqual(["s2 archive"])
    expect(sessions.list()).toEqual([])
  })

  it("forgets the sessions of deleted bots", async () => {
    const { sessions, table } = world()
    await sessions.entrust("a", "s1")
    await sessions.entrust("b", "t1")
    await sessions.purge((botId) => botId === "b")
    expect([...table.map.keys()]).toEqual(["t1"])
  })

  it("refuses the owner's input that is not an id or an answerer, and bots that are not listed", async () => {
    const { sessions } = world()
    const panel = createManagedPanel({ sessions, listed: (botId) => botId === "a" })
    await expect(panel.entrust("a", "../x")).rejects.toThrow("sessionId is invalid")
    await expect(panel.entrust("b", "t1")).rejects.toThrow('bot "b" does not exist')
    await panel.entrust("a", "s1")
    await expect(panel.setAnswerer("a", "s1", "anyone")).rejects.toThrow("answerer must be")
    await expect(panel.release("a", "s1")).resolves.toEqual({ sessions: [] })
  })
})

const session = (extra: Partial<BotManagedSession> = {}): BotManagedSession => ({
  botId: "a",
  sessionId: "s1",
  target: { kind: "bot" },
  answerer: "main",
  origin: "main",
  label: "Sum",
  since: 1,
  ...extra,
})

describe("session notices", () => {
  const cases: [SessionNoticeEvent, string][] = [
    [{ kind: "turn", turn: { phase: "completed" } }, "turn completed. Read it with session_read."],
    [
      { kind: "turn", turn: { phase: "failed", message: "rate\nlimited" } },
      "turn failed: rate limited. Read it with session_read.",
    ],
    [{ kind: "turn", turn: { phase: "cancelled", by: "user" } }, "turn cancelled."],
    [
      { kind: "waiting", interaction: "question", answerer: "main" },
      "waiting for an answer to a question; you answer it with session_answer (see session_read).",
    ],
    [
      { kind: "waiting", interaction: "plan-review", answerer: "owner" },
      "waiting for a plan review; your owner answers it in the Web UI.",
    ],
    [
      { kind: "released", by: "owner" },
      "your owner took this session back; you no longer manage it.",
    ],
    [{ kind: "released", by: "archive" }, "archived by your owner; you no longer manage it."],
    [
      { kind: "released", by: "revoked" },
      "your owner withdrew your access to its Workspace; you no longer manage it.",
    ],
    [
      { kind: "released", by: "workspace-removed" },
      "its Workspace was removed from DSH; you no longer manage it.",
    ],
    [
      { kind: "waiting", interaction: "approval", answerer: "main" },
      "waiting for an approval; your owner answers it in the Web UI.",
    ],
  ]
  it.each(cases)("words %j", (event, text) => {
    expect(sessionNotice(session(), event).text).toBe(`[session] "Sum" (s1) — ${text}`)
  })

  it("names the Workspace of a Workspace session", () => {
    expect(
      sessionNotice(session({ target: { kind: "workspace", workspaceId: "w1" } }), {
        kind: "turn",
        turn: { phase: "completed" },
      }).text,
    ).toBe('[session] "Sum" (s1, Workspace w1) — turn completed. Read it with session_read.')
  })

  it("names a session without a label by its id only, and keeps the summary to one line", () => {
    const notice = sessionNotice(session({ label: undefined }), {
      kind: "turn",
      turn: { phase: "failed", message: "x".repeat(300) },
    })
    expect(notice.text.startsWith("[session] (s1) — turn failed: x")).toBe(true)
    expect(notice.summary.length).toBe(120)
  })
})

describe("following managed sessions", () => {
  const setup = () => {
    const told: string[] = []
    const follow = createManagedFollow({
      managed: (sessionId) => (sessionId === "s1" ? session() : undefined),
      tell: (managed, event) => told.push(`${managed.sessionId} ${JSON.stringify(event)}`),
    })
    const end = (sessionId: string, reason: unknown) =>
      follow.sessionEvent(sessionId, { type: "turn/end", data: { turn: 1, reason } })
    return { told, follow, end }
  }

  it("tells every live turn end of a managed session, not a closer written after the fact", () => {
    const { told, end, follow } = setup()
    end("s1", { kind: "completed" })
    end("s1", { kind: "error", error: { message: "boom" } })
    end("s1", { kind: "interrupted" })
    end("s2", { kind: "completed" })
    follow.sessionEvent("s1", { type: "turn/start", data: {} })
    expect(told).toEqual([
      's1 {"kind":"turn","turn":{"phase":"completed"}}',
      's1 {"kind":"turn","turn":{"phase":"failed","message":"boom"}}',
    ])
  })

  it("leaves out the cancellation the Main session asked for, once", () => {
    const { told, end, follow } = setup()
    follow.stopping("s1")
    end("s1", { kind: "aborted", reason: { kind: "user" } })
    end("s1", { kind: "aborted", reason: { kind: "user" } })
    expect(told).toEqual(['s1 {"kind":"turn","turn":{"phase":"cancelled","by":"user"}}'])
  })

  it("tells a question or plan review that opens with who answers it, never an approval", () => {
    const { told, follow } = setup()
    follow.opened("s1", { id: "i1", kind: "question", questions: [] })
    follow.opened("s1", {
      id: "i2",
      kind: "approval",
      question: { en: "?" },
      actions: ["allow-once"],
      delegated: false,
    } as never)
    follow.opened("s2", { id: "i3", kind: "plan-review", question: "ok?", plan: "p" })
    expect(told).toEqual(['s1 {"kind":"waiting","interaction":"question","answerer":"main"}'])
  })
})

describe("transcripts", () => {
  const message = (
    id: string,
    role: string,
    source: TranscriptMessage["source"],
    content: TranscriptMessage["content"],
  ): TranscriptMessage => ({ id, role, source, content })
  const messages = [
    message("u1", "user", { kind: "user" }, [{ type: "text", text: "hello" }]),
    message("c1", "user", { kind: "agent-instructions", form: "instructions" }, [
      { type: "text", text: "AGENTS.md" },
    ]),
    message("r1", "user", { kind: "bot-main-relay", form: "relay" }, [
      { type: "text", text: "Your Main session sent a message:" },
      { type: "text", text: "Add 1 and 2." },
    ]),
    message("a1", "assistant", { kind: "model" }, [
      { type: "text", text: "Adding." },
      { type: "tool-call", name: "bash" },
    ]),
    message("t1", "tool", { kind: "tool" }, [{ type: "text", text: "3" }]),
    message("n1", "user", { kind: "bot-schedule", form: "notice", summary: "a notice" }, [
      { type: "text", text: "long notice" },
    ]),
    message("a2", "assistant", { kind: "model" }, [{ type: "text", text: "3" }]),
  ]

  it("keeps what people and the model wrote, the newest ones, and ends at the last message", () => {
    expect(transcriptOf(messages, { limit: 3 })).toEqual({
      entries: [
        { id: "a1", speaker: "assistant", text: "Adding.\n[called: bash]" },
        { id: "n1", speaker: "notice", text: "a notice" },
        { id: "a2", speaker: "assistant", text: "3" },
      ],
      omitted: 2,
      cursor: "a2",
    })
    expect(transcriptOf(messages, { after: "u1", limit: 1 }).entries).toEqual([
      { id: "a2", speaker: "assistant", text: "3" },
    ])
    expect(transcriptOf(messages, { after: "a2", limit: 5 })).toEqual({
      entries: [],
      omitted: 0,
      cursor: "a2",
    })
    expect(transcriptOf(messages.slice(0, 3), { limit: 5 }).entries.map((e) => e.speaker)).toEqual([
      "owner",
      "main",
    ])
  })

  it("refuses a cursor that is not a message of the session", () => {
    expect(() => transcriptOf(messages, { after: "x", limit: 5 })).toThrow("not a message")
  })

  it("counts what the limit left out in the singular and the plural", () => {
    const entries = [{ id: "a2", speaker: "assistant", text: "3" }] as const
    expect(renderTranscript({ entries, omitted: 1, cursor: "a2" })).toBe(
      "(1 earlier message left out)\n--- session [a2]\n3",
    )
    expect(renderTranscript({ entries, omitted: 2, cursor: "a2" })).toMatch(
      /^\(2 earlier messages left out\)/,
    )
  })
})

describe("delegate models", () => {
  const delegates: BotModelChoice[] = [
    { kind: "profile-default" },
    { kind: "fixed", provider: "p", model: "m", reasoningEffort: "high" },
    { kind: "fixed", provider: "p", model: "light" },
  ]
  it("names each choice by one id and finds it among the delegates", () => {
    expect(delegates.map(modelIdOf)).toEqual(["profile-default", "p/m@high", "p/light"])
    expect(delegateNamed(delegates, "p/m@high")).toEqual(delegates[1])
    expect(delegateNamed(delegates, "p/m")).toBeUndefined()
    expect(isDelegate(delegates, { kind: "fixed", provider: "p", model: "light" })).toBe(true)
    expect(isDelegate(delegates, { kind: "fixed", provider: "p", model: "m" })).toBe(false)
  })
})

describe("session tools", () => {
  const question: BotInteraction = {
    id: "q1",
    kind: "question",
    questions: [{ id: "a", question: "Which?", options: [{ label: "x" }], multiSelect: false }],
  }
  const grant: BotWorkspaceGrant = {
    botId: "a",
    workspaceId: "w1",
    agentPreset: "standard",
    permission: { sandbox: "workspace-write", approval: "ask" },
    model: { kind: "fixed", provider: "p", model: "big" },
    since: 1,
  }
  const setup = (delegates: readonly BotModelChoice[] = []) => {
    const w = world()
    const created: { title: string; model: BotSessionModelRequest }[] = []
    const inWorkspace: { workspaceId: string; title: string; model: BotModelChoice }[] = []
    let refused: string | undefined
    const waits = new Map<string, DshWait[]>()
    const sent: { sessionId: string; message: MainMessage; mode: string }[] = []
    const answered: { sessionId: string; answer: BotInteractionAnswer }[] = []
    const stopped: string[] = []
    const archived: string[] = []
    const stopping: string[] = []
    const open = new Map<string, BotInteraction[]>()
    const tools = createManagedTools({
      refusal: (_botId, token, agentId) =>
        token !== "t" ? "stale" : agentId === "m" ? undefined : "only in the Main session",
      sessions: w.sessions,
      models: () => ({ main: { kind: "profile-default" }, delegates }),
      async create(_botId, title, model) {
        created.push({ title, model })
        return "s1"
      },
      async createInWorkspace(granted, options) {
        inWorkspace.push({ workspaceId: granted.workspaceId, ...options })
        return "ws2"
      },
      workspaces: (botId) =>
        botId === "a"
          ? [{ grant, workspace: { workspaceId: "w1", title: "Site", path: "/tmp/site" } }]
          : [],
      authority: () => refused,
      botName: () => "Ada",
      waits: (sessionId) => waits.get(sessionId) ?? [],
      async send(sessionId, message, mode) {
        sent.push({ sessionId, message, mode })
      },
      messages: async () => [],
      activity: (sessionId) => (sessionId === "s1" ? "running" : "idle"),
      interactions: (sessionId) => open.get(sessionId) ?? [],
      async answer(sessionId, _id, answer) {
        answered.push({ sessionId, answer })
        return { accepted: true }
      },
      stop: (sessionId) => stopped.push(sessionId),
      archive: async (sessionId) => {
        archived.push(sessionId)
      },
      follow: { stopping: (sessionId) => stopping.push(sessionId) },
    })
    const call = (tool: Parameters<typeof tools.call>[2]["tool"], args: unknown, agentId = "m") =>
      tools.call("a", "t", { agentId, tool, args })
    const refuse = (reason: string | undefined) => {
      refused = reason
    }
    return {
      ...w,
      tools,
      call,
      created,
      inWorkspace,
      sent,
      answered,
      stopped,
      archived,
      stopping,
      open,
      waits,
      refuse,
    }
  }

  it("is the Main session's only", async () => {
    const h = setup()
    expect(h.tools.available("a", "t", "m")).toBe(true)
    expect(h.tools.available("a", "t", "s1")).toBe(false)
    expect(h.tools.available("a", "old", "m")).toBe(false)
    await expect(h.call("session_list", {}, "s1")).rejects.toThrow("only in the Main session")
  })

  it("starts a session on the main model or a delegate, records it managed, then sends its instruction", async () => {
    const h = setup([{ kind: "fixed", provider: "p", model: "light" }])
    await expect(
      h.call("session_start", { target: "bot", title: "Sum", instruction: "go", model: "p/m" }),
    ).rejects.toThrow('"p/m" is not one of your delegate models: p/light')
    await expect(
      h.call("session_start", { target: "workspace", title: "Sum", instruction: "go" }),
    ).rejects.toThrow("target")
    await expect(
      h.call("session_start", { target: "elsewhere", title: "Sum", instruction: "go" }),
    ).rejects.toThrow("target")
    const started = await h.call("session_start", {
      target: "bot",
      title: "Sum",
      instruction: "Add 1 and 2.",
      model: "p/light",
    })
    expect(h.created).toEqual([
      {
        title: "Sum",
        model: { role: "delegate", choice: { kind: "fixed", provider: "p", model: "light" } },
      },
    ])
    expect(started.text).toContain("Started session s1")
    expect(h.sessions.get("s1")).toMatchObject({ origin: "main", answerer: "main", label: "Sum" })
    expect(h.sent).toEqual([
      {
        sessionId: "s1",
        mode: "queue",
        message: {
          content: [
            { type: "text", text: "Your Main session sent a message:" },
            { type: "text", text: "Add 1 and 2." },
          ],
          source: { kind: "bot-main-relay", form: "relay" },
        },
      },
    ])
  })

  it("says a bot without delegates starts sessions on its main model only", async () => {
    const h = setup()
    await expect(
      h.call("session_start", { target: "bot", title: "Sum", instruction: "go", model: "p/m" }),
    ).rejects.toThrow("no delegate models")
    await h.call("session_start", { target: "bot", title: "Sum", instruction: "go" })
    expect(h.created[0]?.model).toEqual({ role: "main" })
  })

  it("operates only sessions the bot's Main manages", async () => {
    const h = setup()
    await expect(h.call("session_send", { session_id: "s2", message: "hi" })).rejects.toThrow(
      "not managed",
    )
    await h.sessions.entrust("a", "s2")
    await h.call("session_send", { session_id: "s2", message: "hi", mode: "steer" })
    expect(h.sent.at(-1)?.mode).toBe("steer")
  })

  it("answers a question as the Main only when the Main is the answerer", async () => {
    const h = setup()
    await h.sessions.entrust("a", "s2")
    h.open.set("s2", [question])
    await expect(
      h.call("session_answer", { session_id: "s2", interaction_id: "q1", approved: true }),
    ).rejects.toThrow("answers: give one answer per question")
    await h.call("session_answer", {
      session_id: "s2",
      interaction_id: "q1",
      answers: [{ id: "a", selected: ["x"] }],
    })
    expect(h.answered).toEqual([
      {
        sessionId: "s2",
        answer: { kind: "question", answers: [{ id: "a", selected: ["x"] }] },
      },
    ])
    await h.sessions.setAnswerer("a", "s2", "owner")
    await expect(
      h.call("session_answer", {
        session_id: "s2",
        interaction_id: "q1",
        answers: [{ id: "a", selected: ["x"] }],
      }),
    ).rejects.toThrow("your owner answers")
  })

  it("reads a session's state, waiting questions and messages", async () => {
    const h = setup()
    await h.sessions.entrust("a", "s2")
    h.open.set("s2", [question])
    const read = await h.call("session_read", { session_id: "s2" })
    expect(read.text).toContain("Session s2: waiting; questions answered by you.")
    expect(read.text).toContain("  - [a] Which? (options: x)")
    expect(read.text).toContain("(no new messages)")
  })

  it("stops a running turn, marking its end as the Main's own, and releases with an archive", async () => {
    const h = setup()
    await h.call("session_start", { target: "bot", title: "Sum", instruction: "go" })
    await h.call("session_stop", { session_id: "s1" })
    expect(h.stopping).toEqual(["s1"])
    expect(h.stopped).toEqual(["s1"])
    const listed = await h.call("session_list", {})
    expect(listed.text).toContain('- s1 "Sum": started by you; questions answered by you; running')
    expect(listed.text).toContain("omit model for your main model (profile-default)")
    await h.call("session_release", { session_id: "s1", archive: true })
    expect(h.archived).toEqual(["s1"])
    expect(h.ended).toEqual([])
    expect(h.sessions.list()).toEqual([])
  })
})

describe("session tools in Workspaces", () => {
  const grant: BotWorkspaceGrant = {
    botId: "a",
    workspaceId: "w1",
    agentPreset: "standard",
    permission: { sandbox: "workspace-write", approval: "ask" },
    model: { kind: "fixed", provider: "p", model: "big" },
    since: 1,
  }
  const setup = () => {
    const w = world()
    const created: { workspaceId: string; title: string; model: BotModelChoice }[] = []
    const sent: { sessionId: string; message: MainMessage }[] = []
    const waits = new Map<string, DshWait[]>()
    let refused: string | undefined
    const tools = createManagedTools({
      refusal: (_botId, _token, agentId) =>
        agentId === "m" ? undefined : "only in the Main session",
      sessions: w.sessions,
      models: () => ({
        main: { kind: "profile-default" },
        delegates: [{ kind: "fixed", provider: "p", model: "light" }],
      }),
      create: async () => "s1",
      async createInWorkspace(granted, options) {
        created.push({ workspaceId: granted.workspaceId, ...options })
        return created.length === 1 ? "ws2" : "ws1"
      },
      workspaces: (botId) =>
        botId === "a"
          ? [{ grant, workspace: { workspaceId: "w1", title: "Site", path: "/tmp/site" } }]
          : [],
      authority: () => refused,
      botName: () => "Ada",
      async send(sessionId, message) {
        sent.push({ sessionId, message })
      },
      messages: async () => [],
      activity: () => "idle",
      interactions: () => [],
      waits: (sessionId) => waits.get(sessionId) ?? [],
      answer: async () => ({ accepted: true }),
      stop: () => {},
      archive: async () => {},
      follow: { stopping: () => {} },
    })
    const call = (tool: Parameters<typeof tools.call>[2]["tool"], args: unknown) =>
      tools.call("a", "t", { agentId: "m", tool, args })
    return {
      ...w,
      call,
      created,
      sent,
      waits,
      refuse: (reason: string | undefined) => {
        refused = reason
      },
    }
  }

  it("starts a session in a granted Workspace on its model, the owner answering, with a relay naming the bot", async () => {
    const h = setup()
    await expect(
      h.call("session_start", { target: "workspace:w2", title: "Fix", instruction: "go" }),
    ).rejects.toThrow('Workspace "w2" is not one granted to you')
    await h.call("session_start", { target: "workspace:w1", title: "Fix", instruction: "Fix it." })
    await h.call("session_start", {
      target: "workspace:w1",
      title: "Fix",
      instruction: "go",
      model: "p/light",
    })
    expect(h.created).toEqual([
      { workspaceId: "w1", title: "Fix", model: grant.model },
      { workspaceId: "w1", title: "Fix", model: { kind: "fixed", provider: "p", model: "light" } },
    ])
    expect(h.sessions.get("ws2")).toMatchObject({
      target: { kind: "workspace", workspaceId: "w1" },
      answerer: "owner",
      origin: "main",
    })
    expect(h.sent[0]?.message.content).toEqual([
      {
        type: "text",
        text: 'Bot "Ada", which your owner lets manage this session, sent a message:',
      },
      { type: "text", text: "Fix it." },
    ])
  })

  it("lists the granted Workspaces with what their sessions run under, and what waits for the owner", async () => {
    const h = setup()
    await h.sessions.entrust("a", "ws1")
    h.waits.set("ws1", [{ id: "d1", kind: "approval", summary: "bash: rm" }])
    const listed = await h.call("session_list", {})
    expect(listed.text).toContain(
      '- workspace:w1 "Site" at /tmp/site: Agent preset standard, sandbox workspace-write, approval ask, model p/big',
    )
    expect(listed.text).toContain(
      "- ws1 (Workspace w1): handed over by your owner; questions answered by your owner; waiting",
    )
    const read = await h.call("session_read", { session_id: "ws1" })
    expect(read.text).toContain("Waiting for your owner in the Web UI:\n- approval: bash: rm")
  })

  it("refuses every Workspace operation in a turn that took in someone else's message, bot sessions still work", async () => {
    const h = setup()
    await h.sessions.entrust("a", "ws1")
    await h.sessions.entrust("a", "s2")
    h.refuse("someone else wrote")
    await expect(
      h.call("session_start", { target: "workspace:w1", title: "Fix", instruction: "go" }),
    ).rejects.toThrow("someone else wrote")
    for (const [tool, args] of [
      ["session_send", { session_id: "ws1", message: "hi" }],
      ["session_read", { session_id: "ws1" }],
      ["session_stop", { session_id: "ws1" }],
      ["session_release", { session_id: "ws1" }],
    ] as const) {
      await expect(h.call(tool, args)).rejects.toThrow("someone else wrote")
    }
    await h.call("session_send", { session_id: "s2", message: "hi" })
    const listed = await h.call("session_list", {})
    expect(listed.text).toContain("Workspace sessions are not listed: someone else wrote.")
    expect(listed.text).not.toContain("ws1")
    expect(listed.text).toContain("- s2")
  })
})
