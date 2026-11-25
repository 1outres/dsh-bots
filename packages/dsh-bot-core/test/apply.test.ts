import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Context, Service } from "@deepseek-ai/cordis"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type BotEnvironment, botOf, type EnsureOptions } from "../src/contract"
import type { BotRecord, BotSessionRecord } from "../src/host/domain"
import type { EnvironmentPanel } from "../src/host/environment-spec/panel"
import { DEFAULT_FILES_LIMITS } from "../src/host/files"
import type { MainPanel } from "../src/host/mains/panel"
import type { NotesPanel } from "../src/host/notes/panel"
import type { OnboardingPanel } from "../src/host/onboarding/panel"
import { releaseSourceOf } from "../src/host/onboarding/source"
import type { BotsBackend } from "../src/host/remote"
import { HOST_REMOTE_CONTRIBUTION, type HostRemoteContribution } from "../src/host/remote-contract"
import type { SkillPanel } from "../src/host/skills/panel"
import * as core from "../src/index"
import {
  ATTACH_ENVIRONMENT_SERVICES,
  type AttachEnvironmentServices,
  CALL_SCHEDULE_TOOL,
  CALL_SESSION_TOOL,
  type CallScheduleTool,
  type CallSessionTool,
  SCHEDULE_TOOL_AVAILABLE,
  type ScheduleToolAvailable,
  SESSION_TOOLS_AVAILABLE,
  type SessionToolsAvailable,
} from "../src/internal"
import {
  type BotEnvironmentCapacity,
  type BotEnvironmentSpec,
  DEFAULT_BOT_ENVIRONMENT_SPEC,
} from "../src/shared/environment"
import type { BotFilesApi } from "../src/shared/files-api"
import { TEST_CAPACITY } from "./support/environment"
import { memoryNotesFs } from "./support/notes-fs"

// The browser bridge (TC39 decorators) is not under test here; it only hands out its backend.
const remotes = vi.hoisted(() => [] as BotsBackend[])
/** The botFiles Remote's backends (BotFilesRemoteService). */
const fileRemotes = vi.hoisted(() => [] as BotFilesApi[])
/** The botMains Remote's panels (BotMainsRemoteService). */
const mainPanels = vi.hoisted(() => [] as MainPanel[])
/** The botEnvironment Remote's panels (BotEnvironmentRemoteService). */
const environmentPanels = vi.hoisted(() => [] as EnvironmentPanel[])
const onboardingPanels = vi.hoisted(() => [] as OnboardingPanel[])
/** The botSkills Remote's panels (BotSkillsRemoteService). */
const skillPanels = vi.hoisted(() => [] as SkillPanel[])
/** The botNotes Remote's panels (BotNotesRemoteService). */
const notesPanels = vi.hoisted(() => [] as NotesPanel[])
/** The browser's "New session" handlers (BotsRemoteService.createSession). */
const starters = vi.hoisted(() => [] as ((botId: string) => Promise<{ sessionId: string }>)[])
/** Opening messages queued with followup: session id and text. */
const followups = vi.hoisted(() => [] as { sessionId: string; text: string; summary: string }[])
vi.mock("../src/host/remote", () => ({
  BotsRemoteService: class {
    constructor(_ctx: unknown, backend: BotsBackend) {
      remotes.push(backend)
      starters.push(backend.createSession)
    }
  },
  BotFilesRemoteService: class {
    constructor(_ctx: unknown, files: BotFilesApi) {
      fileRemotes.push(files)
    }
  },
  BotInteractionsRemoteService: class {},
  BotConnectorsRemoteService: class {},
  BotConnectorActionsRemoteService: class {},
  BotConnectionsRemoteService: class {},
  BotConnectorStreamsRemoteService: class {},
  BotWebRemoteService: class {},
  BotManagedSessionsRemoteService: class {},
  BotWorkspacesRemoteService: class {},
  BotMainsRemoteService: class {
    constructor(_ctx: unknown, panel: MainPanel) {
      mainPanels.push(panel)
    }
  },
  BotSkillsRemoteService: class {
    constructor(_ctx: unknown, panel: SkillPanel) {
      skillPanels.push(panel)
    }
  },
  BotNotesRemoteService: class {
    constructor(_ctx: unknown, panel: NotesPanel) {
      notesPanels.push(panel)
    }
  },
  BotEnvironmentRemoteService: class {
    constructor(_ctx: unknown, panel: EnvironmentPanel) {
      environmentPanels.push(panel)
    }
  },
  BotOnboardingRemoteService: class {
    constructor(_ctx: unknown, panel: OnboardingPanel) {
      onboardingPanels.push(panel)
    }
  },
}))

/** One fake Host service, registered under `name`. */
function fake(name: string, body: object) {
  return class extends Service {
    constructor(ctx: Context) {
      super(ctx, name)
      Object.assign(this, body)
    }
  }
}

interface FakeAgent {
  id: string
  status: "idle" | "running"
  inbox: { nextTurn: unknown[]; nextStep: unknown[] }
  ctx: {
    tools: {
      restrict(filter: { deny: readonly string[] }): () => void
      guard(guard: (execution: { name: string }) => string | undefined): () => void
    }
    /** The Agent scope's fiber; `inactive` makes it refuse like a disposing scope. */
    fiber: { inactive?: boolean; assertActive(): void }
  }
  session: {
    header: { cwd?: string; parentSession?: string; agentPreset?: string; origin?: string }
    events: { type: string; data: unknown }[]
    append(type: string, data: unknown): void
    ownEvents(): { type: string; data: unknown }[]
  }
  injected: unknown[]
  inject(message: unknown): void
  /** Messages queued as turns of their own (`followup`). */
  followed: { content: { text: string }[]; source: { kind: string } }[]
  followup(message: { content: { text: string }[]; source: { kind: string } }): void
  /** Like dsh-agent's AgentModel: a recorded selection wins over the options. */
  model: {
    current(): { provider: string; model: string; reasoningEffort?: string } | undefined
    select(selection: { provider: string; model: string; reasoningEffort?: string }): void
  }
  /** Composed preset. */
  preset: string | undefined
  /** Tools of its preset (restrictable). */
  presetTools: string[]
  /** Tools on its own scope (visible, not restrictable). */
  own: string[]
  masks: Set<readonly string[]>
  guards: Set<(execution: { name: string }) => string | undefined>
}

/**
 * One ToolDefinition object per scope and name, shaped like dsh-tools': the
 * definition itself, with `name`, `description` and `execute` (no wrapper).
 */
const definitions = new Map<string, { name: string; description: string; execute(): unknown }>()
const definition = (scope: string, name: string) => {
  const key = `${scope}:${name}`
  let value = definitions.get(key)
  if (value === undefined) {
    value = { name, description: name, execute: () => null }
    definitions.set(key, value)
  }
  return value
}

/** Data of the session's last event of `type` (a projection's fold of a whole-value event). */
const lastEvent = (session: FakeAgent["session"], type: string) =>
  session.events.filter((event) => event.type === type).at(-1)?.data

const directoryChanges = (agent: FakeAgent) =>
  agent.session.events.filter((event) => event.type === "working-directory/change")

/**
 * A fake Host. Like the real one: `restrict` refuses names outside the
 * Agent's restrictable set and emits `tools/change` synchronously, Agents are
 * listed live, `register` refuses a duplicate id, and `select` recomposes.
 */
function host(rows: Map<string, BotRecord>, root: Context) {
  const log: string[] = []
  const memberships = new Map<string, BotSessionRecord>()
  /** Tables of the other domains (connectors, notices), by domain and table name. */
  const otherTables = new Map<string, Map<string, unknown>>()
  const otherTable = (domain: string, name: string) => {
    const key = `${domain}:${name}`
    let map = otherTables.get(key)
    if (map === undefined) {
      map = new Map()
      otherTables.set(key, map)
    }
    return map
  }
  /** The environment fs a composed bot Agent sees (dsh-fs-ssh in the VM). */
  const vmDirs = new Set(["/home/bot/workspace", "/home/bot/workspace/sub"])
  const vmFs = {
    resolve: async (path: string, options?: { cwd?: string }) =>
      path.startsWith("/") ? path : `${options?.cwd ?? "/"}/${path}`.replace(/\/\.$/, ""),
    stat: async (target: string) => (vmDirs.has(target) ? { type: "directory" } : undefined),
    processPath: (target: string) => target,
  }
  const presets = new Map<string, { id: string; plugins: { id: string }[] }>()
  /** Contributions registered with typert and not yet withdrawn. */
  const typertContributions = new Set<HostRemoteContribution>()
  const globals = ["working_directory", "team_task"]
  /** DSH's default model (agentDefaultModel); tests may change it. */
  const profileDefault = { provider: "p", model: "m" }
  const live = new Map<string, FakeAgent>()
  const workspaces = new Map<string, string[]>()
  /** DSH's Workspaces (workspaceRegistry.list). */
  const dshWorkspaces: { id: string; title: string; path: string; sessionIds: string[] }[] = []
  let releaseDelay = 0
  const visibleEntries = (agent: FakeAgent) => {
    const hidden = new Set([...agent.masks].flat())
    const inherited = new Map(globals.map((name) => [name, definition("global", name)]))
    for (const name of agent.presetTools) inherited.set(name, definition(agent.preset ?? "", name))
    return [
      ...[...inherited].filter(([name]) => !hidden.has(name)).map(([, value]) => value),
      ...agent.own.map((name) => definition(agent.id, name)),
    ]
  }
  const visible = (agent: FakeAgent) => visibleEntries(agent).map((entry) => entry.name)
  /**
   * An Agent composed from `preset`, whose session header names
   * `headerPreset` (the identity a session keeps), in `cwd`.
   */
  const agent = (
    id: string,
    preset: string | undefined,
    headerPreset: string | undefined,
    presetTools = ["read", "bash"],
    header: { cwd?: string; parentSession?: string; origin?: string } = {},
  ): FakeAgent => {
    const events: { type: string; data: unknown }[] = []
    const created: FakeAgent = {
      id,
      status: "idle",
      inbox: { nextTurn: [], nextStep: [] },
      preset,
      presetTools,
      own: [],
      masks: new Set(),
      guards: new Set(),
      session: {
        header: {
          cwd: headerPreset?.startsWith("bot-") === true ? "/home/bot/workspace" : "/home/me",
          ...(headerPreset === undefined ? {} : { agentPreset: headerPreset }),
          ...header,
        },
        events,
        append: (type, data) => {
          events.push({ type, data })
        },
        ownEvents: () => events,
      },
      injected: [],
      inject: (message) => {
        created.injected.push(message)
      },
      followed: [],
      followup: (message) => {
        created.followed.push(message)
      },
      model: {
        current: () =>
          lastEvent(created.session, "model/selection") as
            | { provider: string; model: string; reasoningEffort?: string }
            | undefined,
        select: (selection) => {
          created.session.append("model/selection", { ...selection })
        },
      },
      ctx: {
        fiber: {
          assertActive() {
            if (this.inactive === true) {
              throw Object.assign(new Error("inactive"), { code: "INACTIVE_EFFECT" })
            }
          },
        },
        tools: {
          guard: (guard) => {
            created.guards.add(guard)
            return () => created.guards.delete(guard)
          },
          restrict: ({ deny }) => {
            const known = new Set([...globals, ...created.presetTools])
            const unknown = deny.filter((name) => !known.has(name))
            if (unknown.length > 0)
              throw new Error(`tools.restrict() names unknown global tools ${unknown}`)
            const mask = [...deny]
            created.masks.add(mask)
            root.emit("tools/change" as never)
            return () => {
              created.masks.delete(mask)
              root.emit("tools/change" as never)
            }
          },
        },
      },
    }
    return created
  }
  const services = {
    typert: {
      register: (contribution: HostRemoteContribution) => {
        typertContributions.add(contribution)
        return async () => {
          typertContributions.delete(contribution)
        }
      },
    },
    storageDomain: {
      open: async (spec: { name: string }) => ({
        table: (name: string) => {
          const map = (
            spec.name !== "dsh_bots"
              ? otherTable(spec.name, name)
              : name === "sessions"
                ? memberships
                : rows
          ) as Map<string, unknown>
          return {
            get: (key: string) => map.get(key),
            entries: () => map.entries(),
            put: async (key: string, value: unknown) => {
              map.set(key, value)
            },
            delete: async (key: string) => map.delete(key),
          }
        },
        close: async () => {},
      }),
    },
    workspaceRegistry: {
      archivedSessionIds: [] as string[],
      unarchiveSession: async () => {},
      archiveSession: async (id: string) => {
        log.push(`archive ${id}`)
      },
      get: (id: string) => {
        const sessionIds = workspaces.get(id)
        return sessionIds === undefined ? undefined : { sessionIds }
      },
      delete: async (id: string) => {
        log.push(`delete workspace ${id}`)
        return workspaces.delete(id)
      },
      list: () => dshWorkspaces,
    },
    sessionController: {
      /** Like session.create in a Workspace: an Agent in its directory, announced, then attached. */
      create: async (request: { workspaceId: string; agentPreset: string }) => {
        const workspace = dshWorkspaces.find((item) => item.id === request.workspaceId)
        if (workspace === undefined) throw new Error("workspace/not-found")
        const created = agent(
          `ws-${workspace.sessionIds.length + 1}`,
          request.agentPreset,
          request.agentPreset,
          ["read", "bash"],
          { cwd: workspace.path },
        )
        live.set(created.id, created)
        await root.serial("agent/created" as never, { agent: created } as never)
        workspace.sessionIds.push(created.id)
        log.push(`create ${created.id} in ${workspace.id} ${request.agentPreset}`)
        return { sessionId: created.id, agentPreset: request.agentPreset }
      },
      rename: async () => {},
      resolveAgent: async (sessionId: string) => ({
        agent: {
          followup: (message: { content: { text: string }[]; source: { summary: string } }) => {
            log.push("followup")
            followups.push({
              sessionId,
              text: message.content[0]?.text ?? "",
              summary: message.source.summary,
            })
          },
        },
      }),
    },
    agentDefaultModel: {
      currentSelection: () => ({ ...profileDefault }),
    },
    /** dsh-llm's registry: provider "p" offers "m" (efforts low, high) and "light". */
    llm: {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async (provider: string) =>
        provider === "p"
          ? [
              { provider: "p", id: "m", name: "M" },
              { provider: "p", id: "light", name: "Light" },
            ]
          : [],
      resolveModelInfo: async (_provider: string, model: string) => ({
        ...(model === "m"
          ? {
              reasoning: {
                efforts: [
                  { id: "low", name: "Low" },
                  { id: "high", name: "High" },
                ],
                defaultEffort: "low",
              },
            }
          : {}),
      }),
      resolveCallConfig: async (config: unknown) => config,
    },
    approval: {
      overrideOf: (session: FakeAgent["session"]) =>
        (lastEvent(session, "approval/policy") as { policy: string } | undefined)?.policy,
    },
    sandboxPolicy: {
      overrideOf: (session: FakeAgent["session"]) =>
        (lastEvent(session, "sandbox/mode") as { mode: string } | undefined)?.mode,
    },
    workingDirectory: {
      get: (session: FakeAgent["session"]) => {
        const changed = session.events.filter((event) => event.type === "working-directory/change")
        const last = changed.at(-1)?.data as { cwd: string } | undefined
        return last?.cwd ?? session.header.cwd ?? "/"
      },
    },
    agentPresets: {
      register: async (preset: { id: string; plugins: { id: string }[] }) => {
        if (presets.has(preset.id)) throw new Error(`Duplicate agent preset: ${preset.id}`)
        presets.set(preset.id, preset)
        log.push(`register ${preset.id}`)
        return async () => {
          // The real registry deletes synchronously; collection may take time.
          if (releaseDelay === 0) presets.delete(preset.id)
          else setTimeout(() => presets.delete(preset.id), releaseDelay)
        }
      },
      resolve: async (id: string) => ({ id }),
      list: async () => [{ id: "standard" }, { id: "bot-a" }],
      defaultId: "standard",
      composedPreset: (ctx: object) => [...live.values()].find((a) => a.ctx === ctx)?.preset,
      mount: async (ctx: { preset?: string }, id: string) => {
        log.push(`mount ${id} registered=${presets.has(id)}`)
        ctx.preset = id
        return { id }
      },
      serviceFor: (target: FakeAgent) =>
        target.preset?.startsWith("bot-") === true ? vmFs : undefined,
      select: async (target: FakeAgent, id: string) => {
        log.push(`select ${target.id} ${id}`)
        target.preset = id
        root.emit("agent-preset/selected" as never, target.id as never, id as never)
        return id
      },
    },
    tools: {
      definitions: (scope?: FakeAgent) =>
        scope === undefined
          ? globals.map((name) => definition("global", name))
          : visibleEntries(scope),
    },
    agents: {
      currentInitiator: () => undefined,
      withoutInitiator: <T>(operation: () => T) => operation(),
      list: () => [...live.values()],
      get: (id: string) => live.get(id),
      /** Like dsh-agent: setup composes, then the Agent is listed and announced. */
      create: async (options: {
        sessionId: string
        agentOptions: { provider?: string; model?: string }
        meta: { cwd: string; agentPreset: string }
        setup(agentCtx: unknown, agent: FakeAgent): Promise<void>
      }) => {
        log.push(
          `create ${options.meta.cwd} ${options.meta.agentPreset} model=${options.agentOptions.model}`,
        )
        const created = agent(options.sessionId, undefined, options.meta.agentPreset, undefined, {
          cwd: options.meta.cwd,
        })
        const scope = created.ctx as unknown as { preset?: string; on?: unknown }
        // installModelSelection registers an agent/pre-step listener on the Agent's scope.
        scope.on = () => () => {}
        await options.setup(created.ctx, created)
        created.preset = scope.preset
        live.set(created.id, created)
        await root.serial("agent/created" as never, { agent: created } as never)
        return { agent: created }
      },
    },
  }
  return {
    services,
    profileDefault,
    log,
    presets,
    typertContributions,
    globals,
    live,
    workspaces,
    dshWorkspaces,
    memberships,
    otherTables,
    vmDirs,
    visible,
    /** Create and publish an Agent the way DSH does: list it, then announce it serially. */
    async announce(created: FakeAgent) {
      live.set(created.id, created)
      try {
        await root.serial("agent/created" as never, { agent: created } as never)
      } catch (error) {
        live.delete(created.id)
        throw error
      }
      return created
    },
    agent,
    /** Why the Agent's own guards refuse a call, as dsh-tools' checkGuards would report. */
    denial: (name: string, target: FakeAgent) => {
      for (const guard of target.guards) {
        const denial = guard({ name })
        if (denial !== undefined) return denial
      }
      return undefined
    },
    setReleaseDelay: (ms: number) => {
      releaseDelay = ms
    },
  }
}

/**
 * A fake bot environment. `ensure` resolves at once unless `hold` is set,
 * then it waits for `release(botId, error?)`.
 */
function environmentFake() {
  const ensured: string[] = []
  const targets: Parameters<BotEnvironment["ensure"]>[0][] = []
  const signals: AbortSignal[] = []
  const removed: string[] = []
  const held = new Map<string, (error?: Error) => void>()
  const progress = new Map<string, NonNullable<EnsureOptions["progress"]>>()
  const listeners = new Set<(botId: string) => void>()
  const state: {
    hold: boolean
    inspected: Map<string, BotEnvironmentSpec>
    capacity: BotEnvironmentCapacity
  } = {
    hold: false,
    inspected: new Map(),
    capacity: TEST_CAPACITY,
  }
  const inspections: string[] = []
  const environment: BotEnvironment = {
    id: "incus-vm",
    isolate: ["fs", "shell"],
    workspace: "/home/bot/workspace",
    ensure: (target, options) => {
      ensured.push(target.id)
      targets.push(target)
      if (options?.signal !== undefined) signals.push(options.signal)
      if (options?.progress !== undefined) progress.set(target.id, options.progress)
      if (!state.hold) return Promise.resolve()
      return new Promise((resolve, reject) => {
        held.set(target.id, (error) => (error === undefined ? resolve() : reject(error)))
      })
    },
    remove: async (botId) => {
      removed.push(botId)
    },
    rows: (target) => [{ id: "env-fs", name: "@x/fs", config: { bot: target.id } }],
    capacity: async () => state.capacity,
    inspect: async (botId) => {
      inspections.push(botId)
      return state.inspected.get(botId)
    },
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    environment,
    inspections,
    ensured,
    targets,
    signals,
    removed,
    state,
    /** Tell bot-core the bot's environment changed (it re-runs ensure). */
    changed(botId: string) {
      for (const listener of listeners) listener(botId)
    },
    release(botId: string, error?: Error) {
      held.get(botId)?.(error)
      held.delete(botId)
    },
    /** Report a step of the bot's latest ensure. */
    report(botId: string, phase: Parameters<NonNullable<EnsureOptions["progress"]>>[0]) {
      progress.get(botId)?.(phase)
    },
  }
}

async function start(
  rows: Map<string, BotRecord>,
  allowedPlugins: string[] = [],
  options: { environment?: boolean; before?: (harness: ReturnType<typeof host>) => void } = {},
) {
  const ctx = new Context()
  const h = host(rows, ctx)
  options.before?.(h)
  const env = environmentFake()
  for (const [name, body] of Object.entries(h.services)) await ctx.plugin(fake(name, body))
  const load = async () => {
    const fiber = ctx.plugin(core, { greeting: "hi {name}", allowedPlugins })
    await fiber
    if (options.environment !== false) botOf(ctx).registerEnvironment(env.environment)
    return fiber
  }
  const fiber = await load()
  const backend = () => {
    const last = remotes.at(-1)
    if (last === undefined) throw new Error("no bots Remote")
    return last
  }
  const snapshot = () => backend().lifecycle.snapshot()
  const pending = (id: string) => snapshot().pending.find((item) => item.id === id)
  const listed = (id: string) => snapshot().bots.find((item) => item.id === id)
  /** Create a bot and wait until it is listed with its Main session. */
  const created = async (name = "New") => {
    const id = await backend().lifecycle.create({
      name,
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    return vi.waitFor(
      () => {
        const view = listed(id)
        if (view === undefined) throw new Error(`bot ${id} is not listed yet`)
        return view
      },
      { timeout: 2_000, interval: 10 },
    )
  }
  return { ...h, ctx, fiber, load, env, backend, snapshot, pending, listed, created }
}

interface PluginRowLike {
  readonly id: string
  readonly config?: { readonly token?: string }
}

const avatar = { kind: "emoji", emoji: "🤖", color: "#6366F1" } as const
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

function bot(extra: Partial<BotRecord> = {}): BotRecord {
  return {
    name: "A",
    avatar,
    mainSessionId: "m",
    mainOnBotPreset: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

describe("bot-core Config", () => {
  it("resolves an omitted config to every default, the files caps as before", () => {
    const config = core.Config({})
    expect(config.files).toEqual(DEFAULT_FILES_LIMITS)
    expect(config).toMatchObject({
      greeting: core.DEFAULT_GREETING,
      allowedPlugins: [],
      allowedHostTools: [],
      environment: core.DEFAULT_ENVIRONMENT,
    })
  })

  it("fills the caps a partial files config leaves out", () => {
    const config = core.Config({ files: { maxBytes: 10, search: { ripgrep: "/opt/rg" } } })
    expect(config.files).toEqual({
      ...DEFAULT_FILES_LIMITS,
      maxBytes: 10,
      search: { ...DEFAULT_FILES_LIMITS.search, ripgrep: "/opt/rg" },
    })
  })
})

const RUNNING = releaseSourceOf(
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")),
).version

/** GitHub's releases of dsh-bots, as the Host reads its release notes: never the network in tests. */
const githubReleases = { urls: [] as string[] }

describe("bot-core apply", () => {
  beforeEach(() => {
    githubReleases.urls.length = 0
    vi.stubGlobal("fetch", async (url: string) => {
      githubReleases.urls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: `v${RUNNING}`,
            draft: false,
            body: "What changed",
            html_url: `https://github.com/1outres/dsh-bots/releases/tag/v${RUNNING}`,
          },
        ],
      }
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("opens the welcome guide on a new installation and finishes it once the guide's bot is listed", async () => {
    await start(new Map())
    const panel = onboardingPanels.at(-1)
    if (panel === undefined) throw new Error("no onboarding Remote")
    expect(panel.view()).toMatchObject({
      version: RUNNING,
      welcome: { status: "open" },
      releaseNotes: [],
    })
    const { id } = await panel.createBot(
      {
        name: "First",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      },
      [],
    )
    expect(panel.view().welcome).toEqual({ status: "creating", botId: id })
    await expect(
      panel.createBot(
        {
          name: "Second",
          avatar,
          workstation: false,
          language: "en",
          timezone: "UTC",
        },
        [],
      ),
    ).rejects.toMatchObject({ code: "bot-onboarding/closed" })
    await vi.waitFor(() => expect(panel.view().welcome).toEqual({ status: "done", botId: id }), {
      timeout: 2_000,
      interval: 10,
    })
  })

  it("shows an existing installation the release notes instead of the guide", async () => {
    await start(new Map([["a", bot()]]))
    const panel = onboardingPanels.at(-1)
    expect(panel?.view().welcome).toEqual({ status: "done" })
    await vi.waitFor(() =>
      expect(panel?.view().releaseNotes.map((note) => note.version)).toEqual([RUNNING]),
    )
    expect(githubReleases.urls).toEqual([
      "https://api.github.com/repos/1outres/dsh-bots/releases?per_page=100&page=1",
    ])
  })

  it("registers its Remote's declared contract with typert", async () => {
    const { typertContributions } = await start(new Map())
    expect([...typertContributions]).toEqual([HOST_REMOTE_CONTRIBUTION])
  })

  it("registers stored bots' presets first, and repairs a missing Main after it", async () => {
    const rows = new Map<string, BotRecord>([
      ["a", bot({ mainSessionId: undefined, mainOnBotPreset: undefined })],
    ])
    const { log, presets } = await start(rows)
    await flush()
    expect(presets.has("bot-a")).toBe(true)
    expect(log.slice(0, 3)).toEqual([
      "register bot-a",
      "create /home/bot/workspace bot-a model=m",
      "mount bot-a registered=true",
    ])
    expect(rows.get("a")?.mainOnBotPreset).toBe(true)
  })

  it("serves a bot session's files only through its own preset's environment fs", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx, presets } = await start(rows)
    await flush()
    const files = fileRemotes.at(-1)
    if (files === undefined) throw new Error("no botFiles Remote")
    const codeOf = (promise: Promise<unknown>) =>
      promise.then(
        () => "ok",
        (error: { code?: string }) => error.code,
      )
    // Not a bot's session: refused.
    expect(await codeOf(files.stat("w1", "notes.md"))).toBe("bot-file/not-bot-session")
    // The bot's Main, but no files row attached yet: no fallback to any other fs.
    expect(await codeOf(files.stat("m", "notes.md"))).toBe("bot-file/unavailable")
    const vmFs = {
      resolve: async (path: string, options?: { cwd?: string }) => ({
        key: path.startsWith("/") ? path : `${options?.cwd}/${path}`,
      }),
      processPath: (target: { key: string }) => target.key,
      lstat: async () => ({ version: "v1", type: "file" }),
      stat: async () => ({ version: "v1", type: "file", size: 3 }),
    }
    // The token bot-core sealed into the registered revision's files row.
    const group = presets.get("bot-a")?.plugins[0] as unknown as { config: PluginRowLike[] }
    const row = group.config.find((entry) => entry.id === "env-bot-core-files")
    const token = row?.config?.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const service = botOf(ctx) as unknown as Record<symbol, AttachEnvironmentServices>
    const attach = (with_: string) =>
      service[ATTACH_ENVIRONMENT_SERVICES]?.call(service, "a", with_, {
        fs: () => vmFs,
        subprocess: () => undefined,
      }) ?? (() => {})
    // Anything but the registered revision's token is kept but never served.
    const forged = attach("0".repeat(64))
    expect(await codeOf(files.stat("m", "notes.md"))).toBe("bot-file/unavailable")
    forged()
    const detach = attach(token ?? "")
    await expect(files.stat("m", "notes.md")).resolves.toEqual({
      absolutePath: "/home/bot/workspace/notes.md",
      version: "v1",
      bytes: 3,
    })
    detach()
    expect(await codeOf(files.stat("m", "notes.md"))).toBe("bot-file/unavailable")
  })

  it("serves a bot session's notes only through its registered revision's environment fs", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx, presets } = await start(rows)
    await flush()
    const panel = notesPanels.at(-1)
    if (panel === undefined) throw new Error("no botNotes Remote")
    const codeOf = (promise: Promise<unknown>) =>
      promise.then(
        () => "ok",
        (error: { code?: string }) => error.code,
      )
    expect(await codeOf(panel.list("w1", undefined))).toBe("bot-note/not-bot-session")
    expect(() => panel.botOf("w1")).toThrow("not a session of a bot")
    expect(await codeOf(panel.list("m", undefined))).toBe("bot-note/unavailable")
    const vmFs = memoryNotesFs()
    vmFs.put(
      "/home/bot/workspace/notes/0193f2a0-0000-7000-8000-000000000001.md",
      "---\ntitle: Alice\ntype: person\nsummary: A friend.\n---\nHello.\n",
    )
    const group = presets.get("bot-a")?.plugins[0] as unknown as { config: PluginRowLike[] }
    const token = group.config.find((entry) => entry.id === "env-bot-core-files")?.config?.token
    const service = botOf(ctx) as unknown as Record<symbol, AttachEnvironmentServices>
    const attach = (with_: string) =>
      service[ATTACH_ENVIRONMENT_SERVICES]?.call(service, "a", with_, {
        fs: () => vmFs,
        subprocess: () => undefined,
      }) ?? (() => {})
    const forged = attach("0".repeat(64))
    expect(await codeOf(panel.list("m", undefined))).toBe("bot-note/unavailable")
    forged()
    const detach = attach(token ?? "")
    const listing = await panel.list("m", undefined)
    expect(listing.notes.map((note) => note.title)).toEqual(["Alice"])
    detach()
    expect(await codeOf(panel.list("m", undefined))).toBe("bot-note/unavailable")
  })

  it("creates sessions through the bot service, under the bot's preset", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx, log } = await start(rows)
    // A bot stored before specs reads its environment's first.
    await flush()
    await expect(botOf(ctx).createSession("a")).resolves.toMatchObject({
      sessionId: expect.any(String),
    })
    expect(log).toContain("create /home/bot/workspace bot-a model=m")
    expect(log).toContain("mount bot-a registered=true")
    expect(
      botOf(ctx)
        .templates()
        .map((template) => template.id),
    ).toEqual(["default"])
  })

  describe("model roles", () => {
    const light = { kind: "fixed", provider: "p", model: "light" } as const
    const selections = (agent: FakeAgent) =>
      agent.session.events.filter((event) => event.type === "model/selection").map((e) => e.data)

    it("gives a bot stored before model roles the defaults, and starts its sessions on DSH's default", async () => {
      const h = await start(new Map([["a", bot()]]))
      expect(botOf(h.ctx).models("a")).toEqual({
        botId: "a",
        models: core.DEFAULT_BOT_MODELS,
        mainPending: false,
      })
      await flush()
      const { sessionId } = await botOf(h.ctx).createSession("a")
      expect(h.log).toContain("create /home/bot/workspace bot-a model=m")
      const created = h.live.get(sessionId) as FakeAgent
      expect(selections(created)).toEqual([])
      h.profileDefault.model = "light"
      await botOf(h.ctx).createSession("a")
      expect(h.log).toContain("create /home/bot/workspace bot-a model=light")
    })

    it("starts new sessions on a fixed main model, recorded on the session", async () => {
      const h = await start(new Map([["a", bot()]]))
      await botOf(h.ctx).configureModels("a", { main: { ...light, reasoningEffort: undefined } })
      const { sessionId } = await botOf(h.ctx).createSession("a")
      expect(h.log).toContain("create /home/bot/workspace bot-a model=light")
      expect(selections(h.live.get(sessionId) as FakeAgent)).toEqual([
        { provider: "p", model: "light" },
      ])
    })

    it("applies a main change to the live Main at once, and leaves other sessions alone", async () => {
      const h = await start(new Map([["a", bot()]]))
      const main = await h.announce(h.agent("m", "bot-a", "bot-a"))
      const other = await h.announce(h.agent("s1", "bot-a", "bot-a"))
      const view = await botOf(h.ctx).configureModels("a", {
        main: { kind: "fixed", provider: "p", model: "m", reasoningEffort: "high" },
      })
      expect(view.mainPending).toBe(true)
      await vi.waitFor(() => expect(botOf(h.ctx).models("a").mainPending).toBe(false))
      expect(selections(main)).toEqual([{ provider: "p", model: "m", reasoningEffort: "high" }])
      expect(selections(other)).toEqual([])
      await botOf(h.ctx).configureModels("a", { utility: light })
      await flush()
      expect(selections(main)).toHaveLength(1)
    })

    it("applies a main change made while the Main was not loaded when its Agent is next loaded, once", async () => {
      const h = await start(new Map([["a", bot()]]))
      await botOf(h.ctx).configureModels("a", { main: light })
      await flush()
      expect(botOf(h.ctx).models("a").mainPending).toBe(true)
      const main = await h.announce(h.agent("m", "bot-a", "bot-a"))
      await vi.waitFor(() => expect(botOf(h.ctx).models("a").mainPending).toBe(false))
      expect(selections(main)).toEqual([{ provider: "p", model: "light" }])
      // A model picked for the Main later (DSH's picker) is not undone by a resume.
      main.model.select({ provider: "p", model: "m" })
      await h.announce(Object.assign(h.agent("m", "bot-a", "bot-a"), { session: main.session }))
      await flush()
      expect(selections(main).at(-1)).toEqual({ provider: "p", model: "m" })
    })

    it("refuses a route DSH cannot run and stores nothing", async () => {
      const h = await start(new Map([["a", bot()]]))
      const { models } = h.backend()
      const refusal = (change: unknown) =>
        models.configure("a", change).then(
          () => undefined,
          (error: { code?: string; details?: unknown }) => ({
            code: error.code,
            details: error.details,
          }),
        )
      expect(await refusal({ main: { kind: "fixed", provider: "q", model: "m" } })).toEqual({
        code: "bot-models/unknown-provider",
        details: { role: "main" },
      })
      expect(await refusal({ utility: { kind: "fixed", provider: "p", model: "nope" } })).toEqual({
        code: "bot-models/unknown-model",
        details: { role: "utility" },
      })
      expect(
        await refusal({
          delegates: [
            light,
            { kind: "fixed", provider: "p", model: "light", reasoningEffort: "high" },
          ],
        }),
      ).toEqual({ code: "bot-models/invalid-effort", details: { role: "delegates", index: 1 } })
      expect(
        await refusal({
          main: { kind: "fixed", provider: "p", model: "m", reasoningEffort: "max" },
        }),
      ).toMatchObject({
        code: "bot-models/invalid-effort",
      })
      expect(await refusal({ helper: light })).toMatchObject({ code: "gateway/bad-request" })
      expect(await refusal({ delegates: [light, light] })).toMatchObject({
        code: "gateway/bad-request",
      })
      expect(await refusal({ main: { kind: "fixed", provider: "p" } })).toMatchObject({
        code: "gateway/bad-request",
      })
      expect(models.view("a").models).toEqual(core.DEFAULT_BOT_MODELS)
      expect(() => models.view("zz")).toThrow(
        expect.objectContaining({ code: "bot-models/not-found" }),
      )
    })

    it("refuses to start a session on a stored main model that DSH no longer offers", async () => {
      const h = await start(new Map([["a", bot()]]))
      await botOf(h.ctx).configureModels("a", { main: light })
      // The registered service is a copy of the fake's methods.
      const llm = h.ctx.get("llm") as { listModels: typeof h.services.llm.listModels }
      llm.listModels = async () => [{ provider: "p", id: "m", name: "M" }]
      await expect(botOf(h.ctx).createSession("a")).rejects.toMatchObject({
        code: "bot-models/unknown-model",
      })
      expect(h.log.some((line) => line.includes("model=light"))).toBe(false)
    })

    it("creates a bot with its models, its Main on the main model", async () => {
      const h = await start(new Map())
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
        models: { main: light, delegates: [light, { kind: "profile-default" }] },
      })
      const view = await vi.waitFor(() => {
        const listed = h.listed(id)
        if (listed === undefined) throw new Error("not listed yet")
        return listed
      })
      const main = h.live.get(view.mainSessionId) as FakeAgent
      expect(selections(main)).toEqual([{ provider: "p", model: "light" }])
      expect(botOf(h.ctx).models(id)).toEqual({
        botId: id,
        models: {
          main: light,
          utility: { kind: "profile-default" },
          delegates: [light, { kind: "profile-default" }],
        },
        mainPending: false,
      })
      await expect(
        h.backend().lifecycle.create({
          name: "Bad",
          avatar,
          workstation: false,
          language: "en",
          timezone: "Asia/Tokyo",
          models: { main: { kind: "fixed", provider: "q", model: "m" } },
        }),
      ).rejects.toMatchObject({ code: "bot-models/unknown-provider" })
      expect(botOf(h.ctx).botIds()).toEqual([id])
    })

    it("lists DSH's providers, models and efforts with its default, and forgets a deleted bot's models", async () => {
      const h = await start(new Map([["a", bot()]]))
      expect(await h.backend().models.catalog()).toEqual({
        profileDefault: { provider: "p", model: "m" },
        providers: [
          {
            id: "p",
            name: "P",
            models: [
              {
                id: "m",
                name: "M",
                reasoning: {
                  efforts: [
                    { id: "low", name: "Low" },
                    { id: "high", name: "High" },
                  ],
                  defaultEffort: "low",
                },
              },
              { id: "light", name: "Light" },
            ],
          },
        ],
        failures: [],
      })
      await expect(botOf(h.ctx).resolveModel({ kind: "profile-default" })).resolves.toEqual({
        provider: "p",
        model: "m",
      })
      await h.backend().lifecycle.remove("a")
      await vi.waitFor(() =>
        expect(() => botOf(h.ctx).models("a")).toThrow(
          expect.objectContaining({ code: "bot-models/not-found" }),
        ),
      )
    })
  })

  it("serves the schedule row: the Main session manages jobs; other sessions see no schedule tool", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const group = h.presets.get("bot-a")?.plugins[0] as unknown as { config: PluginRowLike[] }
    const token = group.config.find((entry) => entry.id === "env-bot-core-schedule")?.config?.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    await h.announce(h.agent("m", "bot-a", "bot-a"))
    await h.announce(h.agent("s1", "bot-a", "bot-a"))
    const service = botOf(h.ctx) as unknown as Record<symbol, unknown>
    const available = (service[SCHEDULE_TOOL_AVAILABLE] as ScheduleToolAvailable).bind(service)
    const call = (service[CALL_SCHEDULE_TOOL] as CallScheduleTool).bind(service)
    expect(available("a", token ?? "", "m", "schedule")).toBe(true)
    expect(available("a", token ?? "", "m", "schedule_result")).toBe(false)
    expect(available("a", token ?? "", "s1", "schedule")).toBe(false)
    expect(available("a", "0".repeat(64), "m", "schedule")).toBe(false)
    expect(botOf(h.ctx).bots()[0]?.timezone).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    const created = await call("a", token ?? "", {
      agentId: "m",
      tool: "schedule",
      args: {
        action: "create",
        name: "Later",
        mode: "main",
        schedule: { kind: "after", delay: "2h" },
        instruction: "Remind the user.",
        timezone: "UTC",
      },
    })
    expect(created.text).toContain('"Later"')
    await expect(
      call("a", token ?? "", { agentId: "s1", tool: "schedule", args: { action: "list" } }),
    ).rejects.toThrow(/Main session and in a scheduled run/)
  })

  it("serves the sessions row: the Main session starts, follows and releases a managed session", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const group = h.presets.get("bot-a")?.plugins[0] as unknown as { config: PluginRowLike[] }
    const token = group.config.find((entry) => entry.id === "env-bot-core-sessions")?.config?.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    await h.announce(h.agent("m", "bot-a", "bot-a"))
    const service = botOf(h.ctx) as unknown as Record<symbol, unknown>
    const available = (service[SESSION_TOOLS_AVAILABLE] as SessionToolsAvailable).bind(service)
    const call = (service[CALL_SESSION_TOOL] as CallSessionTool).bind(service)
    expect(available("a", token ?? "", "m")).toBe(true)
    expect(available("a", "0".repeat(64), "m")).toBe(false)

    await expect(
      call("a", token ?? "", {
        agentId: "m",
        tool: "session_start",
        args: { target: "bot", title: "Sum", instruction: "Add 1 and 2.", model: "p/light" },
      }),
    ).rejects.toThrow("no delegate models")
    const started = await call("a", token ?? "", {
      agentId: "m",
      tool: "session_start",
      args: { target: "bot", title: "Sum", instruction: "Add 1 and 2." },
    })
    const { session } = started.data as { session: { sessionId: string; answerer: string } }
    expect(session.answerer).toBe("main")
    expect(h.memberships.get(session.sessionId)).toMatchObject({ botId: "a", startedBy: "main" })
    const child = h.live.get(session.sessionId) as FakeAgent
    expect(child.followed.map((message) => message.source)).toEqual([
      { kind: "bot-main-relay", form: "relay" },
    ])
    expect(child.followed[0]?.content.map((block) => block.text)).toEqual([
      "Your Main session sent a message:",
      "Add 1 and 2.",
    ])
    expect(available("a", token ?? "", session.sessionId)).toBe(false)
    await expect(
      call("a", token ?? "", { agentId: session.sessionId, tool: "session_list", args: {} }),
    ).rejects.toThrow("only in the bot's Main session")

    h.ctx.emit(
      "session/event" as never,
      { id: session.sessionId } as never,
      { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } } as never,
    )
    await flush()
    const notices = [...(h.otherTables.get("dsh_bot_notices:notices")?.values() ?? [])] as {
      topic: string
      text: string
    }[]
    expect(
      notices.filter((notice) => notice.topic === "session").map((notice) => notice.text),
    ).toEqual([
      `[session] "Sum" (${session.sessionId}) — turn completed. Read it with session_read.`,
    ])

    const listed = await call("a", token ?? "", { agentId: "m", tool: "session_list", args: {} })
    expect(listed.text).toContain(`- ${session.sessionId} "Sum": started by you`)
    await call("a", token ?? "", {
      agentId: "m",
      tool: "session_release",
      args: { session_id: session.sessionId, archive: true },
    })
    expect(h.log).toContain(`archive ${session.sessionId}`)
    await expect(
      call("a", token ?? "", {
        agentId: "m",
        tool: "session_send",
        args: { session_id: session.sessionId, message: "more" },
      }),
    ).rejects.toThrow("not managed")
  })

  it("starts a Workspace session for the Main as an ordinary DSH session under the grant, never a bot's", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows, [], {
      before: (harness) => {
        harness.dshWorkspaces.push({ id: "w1", title: "Site", path: "/tmp/site", sessionIds: [] })
        harness.otherTables.set(
          "dsh_bot_managed_sessions:workspaces",
          new Map([
            [
              "a/w1",
              {
                botId: "a",
                workspaceId: "w1",
                agentPreset: "standard",
                permission: { sandbox: "workspace-write", approval: "ask" },
                model: { kind: "fixed", provider: "p", model: "light" },
                since: 1,
              },
            ],
          ]),
        )
      },
    })
    await flush()
    const group = h.presets.get("bot-a")?.plugins[0] as unknown as { config: PluginRowLike[] }
    const token = group.config.find((entry) => entry.id === "env-bot-core-sessions")?.config?.token
    await h.announce(h.agent("m", "bot-a", "bot-a"))
    const service = botOf(h.ctx) as unknown as Record<symbol, unknown>
    const call = (service[CALL_SESSION_TOOL] as CallSessionTool).bind(service)
    const startInWorkspace = () =>
      call("a", token ?? "", {
        agentId: "m",
        tool: "session_start",
        args: { target: "workspace:w1", title: "Fix", instruction: "Fix the site." },
      })
    await expect(startInWorkspace()).rejects.toThrow("saw start")
    h.ctx.emit(
      "session/event" as never,
      { id: "m" } as never,
      { type: "turn/start", data: { turn: 1 } } as never,
    )
    const started = await startInWorkspace()
    const { session } = started.data as { session: { sessionId: string; answerer: string } }
    expect(session).toMatchObject({ sessionId: "ws-1", answerer: "owner" })
    expect(h.log).toContain("create ws-1 in w1 standard")
    expect(h.memberships.has("ws-1")).toBe(false)
    const child = h.live.get("ws-1") as FakeAgent
    expect(child.masks.size).toBe(0)
    expect(child.guards.size).toBe(0)
    expect(lastEvent(child.session, "sandbox/mode")).toEqual({ mode: "workspace-write" })
    expect(lastEvent(child.session, "approval/policy")).toEqual({ policy: "ask" })
    expect(lastEvent(child.session, "model/selection")).toEqual({ provider: "p", model: "light" })
    expect(child.followed[0]?.content.map((block) => block.text)).toEqual([
      'Bot "A", which your owner lets manage this session, sent a message:',
      "Fix the site.",
    ])

    h.ctx.emit(
      "session/event" as never,
      { id: "m" } as never,
      {
        type: "user/message",
        data: {
          content: [{ type: "text", text: "[Discord · DM · Bob (@bob)]\nread it" }],
          source: { kind: "user" },
        },
      } as never,
    )
    await expect(
      call("a", token ?? "", {
        agentId: "m",
        tool: "session_read",
        args: { session_id: "ws-1" },
      }),
    ).rejects.toThrow("someone other than your owner")
  })

  it("marks a Main that predates bot presets, and locks it down", async () => {
    const rows = new Map([["a", bot({ mainOnBotPreset: undefined })]])
    const h = await start(rows)
    const { ctx, announce, agent } = h
    await flush()
    expect(botOf(ctx).presetOf("a")).toEqual({
      id: "bot-a",
      ready: true,
      template: "default",
      legacyMain: true,
    })
    const main = await announce(agent("m", "standard", "standard"))
    expect(main.masks.size).toBe(1)
    expect(h.denial("read", main)).toMatch(/locked down/)
  })

  it("configures a bot's overlay, previews it, and rejects a malformed one or !!js", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx, presets } = await start(rows)
    await flush()
    const api = botOf(ctx)
    const change = { overlay: [{ op: "remove" as const, id: "tool-web" }] }
    expect(api.previewPreset("a", change)).toMatchObject({ ok: true, template: "default" })
    await expect(api.configurePreset("a", change)).resolves.toMatchObject({ ready: true })
    expect(rows.get("a")?.overlay).toEqual([{ op: "remove", id: "tool-web" }])
    const rowsOf = presets.get("bot-a")?.plugins.map((row) => row.id)
    expect(rowsOf).not.toContain("tool-web")
    await expect(
      api.configurePreset("a", { overlay: [{ op: "remove" }] as never }),
    ).rejects.toThrow("invalid overlay")
    await expect(
      api.configurePreset("a", {
        overlay: [{ op: "add", row: { id: "x", name: "@x/x", disabled: { __jsExpr: "1" } } }],
      }),
    ).rejects.toThrow("Loader expressions")
    await expect(api.configurePreset("a", { template: "nope" })).rejects.toThrow("not registered")
    expect(rows.get("a")?.template).toBeUndefined()
  })

  it("never stores an unvalidated mix of two concurrent changes", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx } = await start(rows)
    await flush()
    const api = botOf(ctx)
    api.registerTemplate({
      id: "slim",
      plugins: [{ id: "persona", name: "@deepseek-ai/dsh-persona" }],
    })
    // Each change alone composes; together the overlay targets a row "slim" lacks.
    const results = await Promise.allSettled([
      api.configurePreset("a", { template: "slim" }),
      api.configurePreset("a", { overlay: [{ op: "remove", id: "tool-web" }] }),
    ])
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(rows.get("a")).toMatchObject({ template: "slim" })
    expect(rows.get("a")?.overlay).toBeUndefined()
  })

  it("rejects a subagent row that would pick a foreign preset", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx } = await start(rows, ["@deepseek-ai/dsh-tool-subagent"])
    await flush()
    await expect(
      botOf(ctx).configurePreset("a", {
        overlay: [
          {
            op: "add",
            row: {
              id: "sub",
              name: "@deepseek-ai/dsh-tool-subagent",
              config: { agentPreset: "standard" },
            },
          },
        ],
      }),
    ).rejects.toThrow("may only use the bot's own preset")
  })

  it("masks bot Agents on agent/created and refuses one it cannot mask", async () => {
    const rows = new Map([["a", bot()]])
    const { announce, agent, visible, denial } = await start(rows)
    await flush()
    const good = await announce(agent("s1", "bot-a", "bot-a"))
    expect(visible(good)).toEqual(["read", "bash"])
    expect(denial("team_task", good)).toMatch(/Host tool/)
    const bad = agent("s2", "bot-a", "bot-a")
    bad.ctx.tools.restrict = () => {
      throw new Error("nope")
    }
    await expect(announce(bad)).rejects.toThrow("could not isolate")
  })

  it("locks down a subagent of a bot Agent that runs another preset", async () => {
    const rows = new Map([["a", bot()]])
    const { announce, agent, visible, denial } = await start(rows)
    await flush()
    await announce(agent("s1", "bot-a", "bot-a"))
    const child = await announce(
      agent("c1", "standard", "standard", ["read", "web_fetch"], {
        parentSession: "s1",
        origin: "subagent",
      }),
    )
    // Host tools are masked; its own preset's tools are refused by the guard.
    expect(visible(child)).toEqual(["read", "web_fetch"])
    expect(denial("web_fetch", child)).toMatch(/locked down/)
    expect(denial("working_directory", child)).toMatch(/locked down/)
  })

  it("locks down a Workspace session that picked a bot preset", async () => {
    const rows = new Map([["a", bot()]])
    const { announce, agent, visible, services, denial } = await start(rows)
    await flush()
    const stray = await announce(agent("w1", "standard", "standard"))
    expect(visible(stray)).toEqual(["working_directory", "team_task", "read", "bash"])
    // The composer picker switches the blank Workspace session to the bot's preset.
    await services.agentPresets.select(stray, "bot-a")
    expect(visible(stray)).toEqual(["read", "bash"])
    expect(denial("read", stray)).toMatch(/outside that bot's sessions/)
  })

  it("switches a blank bot session back to the bot's preset", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    // A blank bot session whose composer picked the default preset.
    const draft = await h.announce(h.agent("d1", "standard", "bot-a"))
    expect(h.denial("read", draft)).toMatch(/locked down/)
    await flush()
    expect(h.log).toContain("select d1 bot-a")
    expect(draft.preset).toBe("bot-a")
    expect(h.visible(draft)).toEqual(["read", "bash"])
    expect(h.denial("read", draft)).toBeUndefined()
    // The picker selects standard again: switched back again.
    await h.services.agentPresets.select(draft, "standard")
    await flush()
    expect(draft.preset).toBe("bot-a")
  })

  it("re-locks a live bot Agent whose preset was switched away, and follows tools/change", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const live = await h.announce(h.agent("s1", "bot-a", "bot-a"))
    h.globals.push("late_tool")
    h.ctx.emit("tools/change" as never)
    expect(h.visible(live)).toEqual(["read", "bash"])
  })

  it("keeps guard and mask across an unload, and takes them over on reload", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const live = await h.announce(h.agent("s1", "bot-a", "bot-a"))
    expect(h.visible(live)).toEqual(["read", "bash"])
    await h.fiber.dispose()
    expect(h.visible(live)).toEqual(["read", "bash"])
    // A Host tool registered while bot-core is off is shown, but still refused.
    h.globals.push("late_tool")
    expect(h.denial("late_tool", live)).toMatch(/Host tool/)
    await h.load()
    // The reload hides it at once and adds no second guard.
    expect(h.visible(live)).toEqual(["read", "bash"])
    expect(live.guards.size).toBe(1)
    expect(live.masks.size).toBe(1)
    await flush()
    expect(h.presets.has("bot-a")).toBe(true)
  })

  it("lets a bot Agent run every tool of its own preset, and refuses Host tools (real wiring)", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const presetTools = ["read", "bash", "edit", "glob", "web_fetch", "skill", "job_list"]
    const live = await h.announce(h.agent("s1", "bot-a", "bot-a", presetTools))
    for (const name of presetTools) expect(h.denial(name, live)).toBeUndefined()
    expect(h.denial("run_code", live)).toBeUndefined()
    expect(h.denial("working_directory", live)).toMatch(/Host tool/)
    expect(h.denial("team_task", live)).toMatch(/Host tool/)
    expect(h.visible(live)).toEqual(presetTools)
  })

  it("isolates an Agent with own-scope tools without failing its mask", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    const child = h.agent("c1", "standard", "bot-a")
    child.own.push("return_result")
    await h.announce(child)
    expect(h.visible(child)).toEqual(["read", "bash", "return_result"])
    expect(h.denial("return_result", child)).toMatch(/locked down/)
    h.globals.push("late_tool")
    h.ctx.emit("tools/change" as never)
    expect(h.visible(child)).not.toContain("late_tool")
  })

  it("refuses outside overlays that name a path, URL, include row or unlisted package", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx } = await start(rows, ["@deepseek-ai/dsh-tool-todo"])
    await flush()
    const api = botOf(ctx)
    const add = (name: string) => ({ overlay: [{ op: "add" as const, row: { id: "x", name } }] })
    for (const name of [
      "/bots/a/evil.mjs",
      "file:///bots/a/evil.mjs",
      "cordis:include",
      "@deepseek-ai/cordis-plugin-include",
      "@evil/plugin",
    ]) {
      await expect(api.configurePreset("a", add(name))).rejects.toThrow("invalid overlay")
      expect(() => api.previewPreset("a", add(name))).toThrow("invalid overlay")
    }
    expect(rows.get("a")?.overlay).toBeUndefined()
    // A plugin the default template uses, and one the config allows, are accepted.
    await expect(
      api.configurePreset("a", add("@deepseek-ai/dsh-tool-todo")),
    ).resolves.toMatchObject({
      ready: true,
    })
    expect(api.previewPreset("a", add("@deepseek-ai/dsh-tool-fs"))).toMatchObject({ ok: true })
  })

  it("retries a registration refused as Duplicate while the old load still releases it", async () => {
    const rows = new Map([["a", bot()]])
    const h = await start(rows)
    await flush()
    h.setReleaseDelay(50)
    const dispose = h.fiber.dispose()
    const reload = h.load()
    await dispose
    await reload
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(h.presets.has("bot-a")).toBe(true)
  })

  it("never holds a scheduled resume past an unload", async () => {
    const rows = new Map([["a", bot({ template: "never" })]])
    const h = await start(rows)
    h.memberships.set("s9", { botId: "a", createdAt: 1 })
    let resumed = false
    const resolving = h.ctx.waterfall(
      "schedule/resolve-agent" as never,
      "s9" as never,
      (async () => {
        resumed = true
        return "agent"
      }) as never,
    )
    await flush()
    expect(resumed).toBe(false)
    await h.fiber.dispose()
    await resolving
    expect(resumed).toBe(true)
  })

  it("lets a scheduled resume of a bot session wait for the bot's preset", async () => {
    const rows = new Map([["a", bot({ template: "late" })]])
    const h = await start(rows)
    h.memberships.set("s9", { botId: "a", createdAt: 1 })
    let resumed = false
    const resolving = h.ctx.waterfall(
      "schedule/resolve-agent" as never,
      "s9" as never,
      (async () => {
        resumed = true
        return "agent"
      }) as never,
    )
    await flush()
    expect(resumed).toBe(false)
    botOf(h.ctx).registerTemplate({
      id: "late",
      plugins: [{ id: "persona", name: "@deepseek-ai/dsh-persona" }],
    })
    await resolving
    expect(resumed).toBe(true)
    expect(h.presets.has("bot-a")).toBe(true)
    // Other sessions do not wait.
    await expect(
      h.ctx.waterfall(
        "schedule/resolve-agent" as never,
        "other" as never,
        (async () => "x") as never,
      ),
    ).resolves.toBe("x")
  })

  it("reports preset changes to subscribers", async () => {
    const rows = new Map([["a", bot()]])
    const { ctx } = await start(rows)
    await flush()
    const changed: string[] = []
    botOf(ctx).onPresetChange((id) => changed.push(id))
    await botOf(ctx).configurePreset("a", { overlay: [{ op: "remove", id: "tool-web" }] })
    expect(changed).toContain("a")
  })

  it("unregisters every bot preset on unload", async () => {
    const rows = new Map([["a", bot()]])
    const { fiber, presets } = await start(rows)
    await flush()
    expect(presets.size).toBe(1)
    await fiber.dispose()
    await flush()
    expect(presets.size).toBe(0)
  })

  describe("working directories (working-directory/access)", () => {
    const access = (
      h: Awaited<ReturnType<typeof start>>,
      agent: FakeAgent,
      path: string | null,
      signal = new AbortController().signal,
    ) => {
      let passed = false
      const result = h.ctx.waterfall(
        "working-directory/access" as never,
        { agent, path, signal } as never,
        (async () => {
          passed = true
          return "host-checked"
        }) as never,
      ) as unknown as Promise<string>
      return result.then((value) => ({ value, passed }))
    }

    it("answers a bot Agent from its environment without calling next(); others go to next()", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      const live = await h.announce(h.agent("s1", "bot-a", "bot-a"))
      await expect(access(h, live, null)).resolves.toEqual({
        value: "/home/bot/workspace",
        passed: false,
      })
      const workspace = await h.announce(h.agent("w1", "standard", "standard"))
      await expect(access(h, workspace, null)).resolves.toEqual({
        value: "host-checked",
        passed: true,
      })
      // A Workspace session that picked a bot preset is not a bot's session: the Host checks it.
      await h.services.agentPresets.select(workspace, "bot-a")
      await expect(access(h, workspace, null)).resolves.toMatchObject({ passed: true })
    })

    it("moves a bot session from a legacy Host directory to the environment's workspace once", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      const legacy = await h.announce(
        h.agent("s1", "bot-a", "bot-a", undefined, { cwd: "/home/u/.dsh/bots/a" }),
      )
      await expect(access(h, legacy, null)).resolves.toEqual({
        value: "/home/bot/workspace",
        passed: false,
      })
      expect(directoryChanges(legacy)).toEqual([
        { type: "working-directory/change", data: { cwd: "/home/bot/workspace" } },
      ])
      expect(legacy.injected).toHaveLength(1)
      await access(h, legacy, null)
      expect(directoryChanges(legacy)).toHaveLength(1)
    })

    it("changes a bot Agent's directory inside its environment, refusing one it lacks", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      const live = await h.announce(h.agent("s1", "bot-a", "bot-a"))
      await expect(access(h, live, "sub")).resolves.toEqual({
        value: "/home/bot/workspace/sub",
        passed: false,
      })
      expect(h.services.workingDirectory.get(live.session)).toBe("/home/bot/workspace/sub")
      await expect(access(h, live, "/etc")).rejects.toThrow("does not exist")
    })

    it("commits nothing after an abort or on an Agent whose scope is tearing down", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      const live = await h.announce(h.agent("s1", "bot-a", "bot-a"))
      const aborted = new AbortController()
      aborted.abort(new Error("stop"))
      await expect(access(h, live, "sub", aborted.signal)).rejects.toThrow("stop")
      live.ctx.fiber.inactive = true
      await expect(access(h, live, "sub")).rejects.toThrow("inactive")
      expect(directoryChanges(live)).toEqual([])
      expect(live.injected).toEqual([])
    })

    it("uses no environment for a bot session's Agent on another bot's preset", async () => {
      const h = await start(
        new Map([
          ["a", bot()],
          ["b", bot({ name: "B", mainSessionId: "mb" })],
        ]),
      )
      await flush()
      await h.announce(h.agent("s1", "bot-a", "bot-a"))
      // A subagent of bot a that named bot b's preset: bot a's, locked down.
      const child = await h.announce(
        h.agent("c1", "bot-b", "bot-b", undefined, {
          parentSession: "s1",
          origin: "subagent",
          cwd: "/nowhere",
        }),
      )
      // The VM would say /nowhere is missing and move it; bot b's VM is never asked.
      await expect(access(h, child, null)).resolves.toEqual({ value: "/nowhere", passed: false })
      expect(directoryChanges(child)).toEqual([])
      await expect(access(h, child, "sub")).rejects.toThrow('does not run bot "a"\'s preset')
    })

    it("checks an uncomposed subagent with its parent's environment", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      await h.announce(h.agent("s1", "bot-a", "bot-a"))
      const child = h.agent("c1", undefined, "bot-a", [], {
        parentSession: "s1",
        origin: "subagent",
      })
      await expect(access(h, child, "/home/bot/workspace")).resolves.toEqual({
        value: "/home/bot/workspace",
        passed: false,
      })
    })
  })

  describe("bot sessions by identity", () => {
    it("records a fork of a bot session as the bot's, but not a subagent or a Workspace session", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      await h.announce(h.agent("f1", "bot-a", "bot-a"))
      await h.announce(
        h.agent("c1", "bot-a", "bot-a", undefined, { parentSession: "f1", origin: "subagent" }),
      )
      await h.announce(h.agent("w1", "standard", "standard"))
      await flush()
      expect([...h.memberships.keys()]).toEqual(["f1"])
      expect(h.listed("a")?.sessionIds).toEqual(["f1"])
    })

    it("locks down a subagent that named another bot's preset", async () => {
      const rows = new Map([
        ["a", bot()],
        ["b", bot({ name: "B", mainSessionId: "mb" })],
      ])
      const h = await start(rows)
      await flush()
      await h.announce(h.agent("s1", "bot-a", "bot-a"))
      const child = await h.announce(
        h.agent("c1", "bot-b", "bot-b", undefined, { parentSession: "s1", origin: "subagent" }),
      )
      expect(h.denial("read", child)).toMatch(/locked down/)
    })

    it("locks down a Workspace Agent's subagent on a bot's preset, never treating it as the bot's", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      await h.announce(h.agent("w1", "standard", "standard"))
      // DSH writes the subagent's selected preset into its header.
      const child = await h.announce(
        h.agent("c1", "bot-a", "bot-a", undefined, { parentSession: "w1", origin: "subagent" }),
      )
      expect(h.denial("read", child)).toMatch(/outside that bot's sessions/)
      expect(h.visible(child)).toEqual(["read", "bash"])
      // Its working directory goes to the Host's check, never the bot's environment.
      let passed = false
      await h.ctx.waterfall(
        "working-directory/access" as never,
        { agent: child, path: null, signal: new AbortController().signal } as never,
        (async () => {
          passed = true
          return "host-checked"
        }) as never,
      )
      expect(passed).toBe(true)
      expect(h.memberships.has("c1")).toBe(false)
    })

    it("locks down a resumed subagent whose parent is not live, unless bot-core recorded it", async () => {
      const h = await start(new Map([["a", bot()]]))
      await flush()
      const orphan = await h.announce(
        h.agent("c1", "bot-a", "bot-a", undefined, { parentSession: "gone", origin: "subagent" }),
      )
      expect(h.denial("read", orphan)).toMatch(/cannot be verified/)
      // Its directory is neither checked on the Host nor in the environment, nor changed.
      let passed = false
      const ensure = (path: string | null) =>
        h.ctx.waterfall(
          "working-directory/access" as never,
          { agent: orphan, path, signal: new AbortController().signal } as never,
          (async () => {
            passed = true
            return "host-checked"
          }) as never,
        ) as unknown as Promise<string>
      await expect(ensure(null)).resolves.toBe("/home/bot/workspace")
      await expect(ensure("sub")).rejects.toThrow("cannot change")
      expect(passed).toBe(false)
      // A fork bot-core recorded as the bot's is the bot's.
      const fork = await h.announce(h.agent("f1", "bot-a", "bot-a"))
      await flush()
      expect(h.memberships.has("f1")).toBe(true)
      expect(h.denial("read", fork)).toBeUndefined()
    })

    it("migrates a version 1 bot: its Workspace's sessions become its own, the Workspace goes", async () => {
      const rows = new Map([
        ["a", bot({ path: "/home/u/.dsh/bots/a", workspaceId: "ws-a", mainSessionId: "m" })],
      ])
      const ctx = new Context()
      const h = host(rows, ctx)
      h.workspaces.set("ws-a", ["m", "s1"])
      for (const [name, body] of Object.entries(h.services)) await ctx.plugin(fake(name, body))
      await ctx.plugin(core, { greeting: "hi", allowedPlugins: [] })
      await flush()
      expect([...h.memberships.keys()]).toEqual(["m", "s1"])
      expect(h.log).toContain("delete workspace ws-a")
      expect(rows.get("a")).not.toHaveProperty("workspaceId")
      expect(rows.get("a")).not.toHaveProperty("path")
    })
  })

  describe("bot environment", () => {
    it("registers no bot preset without an environment, and refuses to create a bot", async () => {
      const rows = new Map([["a", bot()]])
      const h = await start(rows, [], { environment: false })
      await flush()
      expect(h.presets.size).toBe(0)
      expect(botOf(h.ctx).presetOf("a")).toMatchObject({ ready: false, pending: true })
      await expect(
        h.backend().lifecycle.create({
          name: "New",
          avatar,
          workstation: false,
          language: "en",
          timezone: "Asia/Tokyo",
        }),
      ).rejects.toThrow("no bot environment")
      expect(rows.size).toBe(1)
      // Registering one prepares every bot and registers its preset inside the group.
      botOf(h.ctx).registerEnvironment(h.env.environment)
      await flush()
      expect(h.env.ensured).toEqual(["a"])
      expect(botOf(h.ctx).presetOf("a")).toMatchObject({ ready: true })
      expect(h.presets.get("bot-a")?.plugins).toEqual([
        expect.objectContaining({
          id: "bot-environment",
          isolate: expect.objectContaining({ fs: true, shell: true, ptcRuntime: true }),
          config: expect.arrayContaining([{ id: "env-fs", name: "@x/fs", config: { bot: "a" } }]),
        }),
      ])
      const group = h.presets.get("bot-a")?.plugins[0] as { config?: { id: string }[] } | undefined
      expect(group?.config?.[0]?.id).toBe("env-fs")
    })

    it("accepts a new bot at once, shows its steps, and starts its Main once its environment is ready", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      expect(rows.get(id)?.mainSessionId).toBeUndefined()
      await flush()
      expect(h.env.ensured).toEqual([id])
      expect(h.snapshot().bots).toEqual([])
      expect(botOf(h.ctx).bots()).toEqual([])
      expect(botOf(h.ctx).botIds()).toEqual([id])
      expect(h.pending(id)).toMatchObject({
        name: "New",
        avatar,
        operation: { kind: "create", phase: "queued" },
        startedAt: expect.any(Number),
        sessionIds: [],
      })
      h.env.report(id, "creating")
      expect(h.pending(id)?.operation).toEqual({ kind: "create", phase: "creating" })
      h.env.report(id, "connecting")
      expect(h.pending(id)?.operation).toEqual({ kind: "create", phase: "connecting" })
      expect(h.log).toEqual([])
      h.env.release(id)
      const view = await vi.waitFor(() => {
        const found = h.listed(id)
        if (found === undefined) throw new Error("not listed")
        return found
      })
      await flush()
      expect(h.pending(id)).toBeUndefined()
      expect(h.log).toEqual([
        `register bot-${id}`,
        `create /home/bot/workspace bot-${id} model=m`,
        `mount bot-${id} registered=true`,
        "followup",
      ])
      expect(view.mainSessionId).toBe(rows.get(id)?.mainSessionId)
      expect(rows.get(id)?.mainOnBotPreset).toBe(true)
    })

    it("makes a new bot's spec within the Host's capacity, and refuses one the Host cannot give", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      h.env.state.capacity = {
        cpus: { min: 1, max: 2, step: 1 },
        memoryMiB: { min: 1024, max: 3072, step: 512 },
        diskGiB: { min: 10, max: 15, step: 1, growOnly: true },
      }
      botOf(h.ctx).registerConnector({
        id: "desk",
        name: "Desk",
        sessions: "bot",
        creationOption: "workstation",
        minimumSpec: { memoryMiB: 4096 },
        tools: [
          {
            name: "noop",
            description: "Nothing.",
            parameters: {},
            permission: "allow",
            preview: () => ({ title: "Nothing?", fields: [] }),
            async execute() {
              return {}
            },
          },
        ],
      })
      const input = { name: "Small", avatar, language: "en", timezone: "Asia/Tokyo" }
      await expect(h.backend().lifecycle.create({ ...input, workstation: true })).rejects.toThrow(
        "Desk needs 4 GiB of memory, but this Host can give a bot's VM at most 3 GiB",
      )
      expect(rows.size).toBe(0)
      const id = await h.backend().lifecycle.create({ ...input, workstation: false })
      await vi.waitFor(() =>
        expect(h.env.targets.find((target) => target.id === id)?.spec).toEqual({
          cpus: 2,
          memoryMiB: 3072,
          diskGiB: 15,
        }),
      )
      h.env.state.capacity = {
        ...h.env.state.capacity,
        memoryMiB: { min: 1024, max: 512, step: 512 },
      }
      await expect(h.backend().lifecycle.create({ ...input, workstation: false })).rejects.toThrow(
        "this Host cannot give a bot's VM the 1 GiB of memory it needs at least (at most 512 MiB)",
      )
      expect(rows.size).toBe(1)
    })

    it("applies a saved spec at once, and refuses a spec or a connector the other does not allow", async () => {
      const h = await start(new Map())
      const view = await h.created()
      expect(h.env.targets.map((target) => target.spec)).toEqual([DEFAULT_BOT_ENVIRONMENT_SPEC])
      const panel = environmentPanels.at(-1)
      if (panel === undefined) throw new Error("no botEnvironment Remote")
      await panel.refresh(view.id)
      expect(panel.view(view.id)).toMatchObject({
        spec: DEFAULT_BOT_ENVIRONMENT_SPEC,
        capacity: { status: "ready", capacity: TEST_CAPACITY },
        needs: [],
        application: { state: "applied" },
      })
      botOf(h.ctx).registerConnector({
        id: "big",
        name: "Big",
        sessions: "bot",
        minimumSpec: { memoryMiB: 8192 },
        tools: [
          {
            name: "noop",
            description: "Nothing.",
            parameters: {},
            permission: "allow",
            preview: () => ({ title: "Nothing?", fields: [] }),
            async execute() {
              return {}
            },
          },
        ],
      })
      await expect(
        botOf(h.ctx).configureConnector(view.id, "big", { enabled: true, values: {} }),
      ).rejects.toThrow("Big needs 8 GiB of memory or more")
      h.env.state.hold = true
      const larger = { ...DEFAULT_BOT_ENVIRONMENT_SPEC, memoryMiB: 8192, diskGiB: 30 }
      await panel.configure(view.id, larger)
      await flush()
      expect(h.env.targets.at(-1)?.spec).toEqual(larger)
      expect(panel.view(view.id).application.state).toBe("applying")
      h.env.release(view.id)
      await vi.waitFor(() => expect(panel.view(view.id).application).toEqual({ state: "applied" }))
      await botOf(h.ctx).configureConnector(view.id, "big", { enabled: true, values: {} })
      expect(panel.view(view.id).needs).toEqual([
        { connector: "Big", minimum: { memoryMiB: 8192 } },
      ])
      await expect(panel.configure(view.id, { ...larger, memoryMiB: 6144 })).rejects.toThrow(
        "Big needs 8 GiB of memory or more",
      )
      await expect(panel.configure(view.id, { ...larger, diskGiB: 20 })).rejects.toThrow(
        "the disk cannot be made smaller than 30 GiB",
      )
      await expect(panel.configure(view.id, { ...larger, cpus: 64 })).rejects.toThrow(
        "CPUs must be from 1 CPU to 8 CPUs",
      )
      await expect(panel.configure(view.id, { ...larger, extra: 1 })).rejects.toThrow(
        "unknown keys",
      )
      expect(h.env.targets.at(-1)?.spec).toEqual(larger)
    })

    it("ensures a bot whose ensure failed again at once when its spec is saved, not after the backoff", async () => {
      const h = await start(new Map())
      const view = await h.created()
      const panel = environmentPanels.at(-1)
      if (panel === undefined) throw new Error("no botEnvironment Remote")
      h.env.state.hold = true
      h.env.changed(view.id)
      await flush()
      h.env.release(view.id, new Error("Incus refused: project limits.memory exceeded"))
      await vi.waitFor(() => expect(panel.view(view.id).application.state).toBe("failed"))
      const before = h.env.targets.length
      await panel.configure(view.id, { ...DEFAULT_BOT_ENVIRONMENT_SPEC, memoryMiB: 4096 })
      await flush()
      expect(h.env.targets.length).toBe(before + 1)
      expect(h.env.targets.at(-1)?.spec.memoryMiB).toBe(4096)
      h.env.state.hold = false
      h.env.release(view.id)
      await vi.waitFor(() => expect(panel.view(view.id).application).toEqual({ state: "applied" }))
    })

    it("gives a bot stored before specs what its environment runs with, without ensuring it again", async () => {
      const h = await start(new Map([["a", bot()]]), [], { environment: false })
      const kept = { cpus: 2, memoryMiB: 4096, diskGiB: 10 }
      h.env.state.inspected.set("a", kept)
      botOf(h.ctx).registerEnvironment(h.env.environment)
      await flush()
      expect(h.env.inspections).toEqual(["a"])
      expect(h.env.targets.map((target) => target.spec)).toEqual([kept])
      const panel = environmentPanels.at(-1)
      expect(panel?.view("a")).toMatchObject({ spec: kept, application: { state: "applied" } })
      h.env.changed("a")
      await flush()
      expect(h.env.inspections).toEqual(["a"])
      expect(h.env.targets.map((target) => target.spec)).toEqual([kept, kept])
    })

    it("creates a bot with the workstation option on the default spec, its option's connectors enabled", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      const connector = (id: string, workstation: boolean, memoryMiB: number) => ({
        id,
        name: id,
        sessions: "bot" as const,
        minimumSpec: { memoryMiB },
        ...(workstation ? { creationOption: "workstation" as const } : {}),
        preparation: {
          async prepare() {},
        },
        tools: [
          {
            name: "noop",
            description: "Nothing.",
            parameters: {},
            permission: "allow" as const,
            preview: () => ({ title: "Nothing?", fields: [] }),
            async execute() {
              return {}
            },
          },
        ],
      })
      expect(await h.backend().creationOptions()).toEqual({
        options: [],
        capacity: { status: "ready", capacity: TEST_CAPACITY },
      })
      await expect(
        h.backend().lifecycle.create({
          name: "New",
          avatar,
          workstation: true,
          language: "en",
          timezone: "Asia/Tokyo",
        }),
      ).rejects.toThrow("no registered connector offers the workstation option")
      expect(rows.size).toBe(0)
      botOf(h.ctx).registerConnector(connector("big", true, 4096))
      botOf(h.ctx).registerConnector(connector("other", false, 8192))
      expect((await h.backend().creationOptions()).options).toEqual([
        { option: "workstation", needs: [{ connector: "big", minimum: { memoryMiB: 4096 } }] },
      ])
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: true,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await flush()
      expect(h.env.targets.map((target) => target.spec)).toEqual([DEFAULT_BOT_ENVIRONMENT_SPEC])
      const states = () => botOf(h.ctx).connectorStates(id)
      expect(states().map((view) => [view.connector.id, view.enabled])).toEqual([
        ["big", true],
        ["other", false],
      ])
      expect(states()[1]?.readiness).toEqual({ state: "disabled" })
      h.env.state.hold = false
      h.env.release(id)
      await flush()
      expect(states()[0]?.readiness.state).not.toBe("disabled")
      expect(h.env.targets).toHaveLength(1)
      const plain = await h.backend().lifecycle.create({
        name: "Plain",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      expect(
        botOf(h.ctx)
          .connectorStates(plain)
          .map((view) => view.enabled),
      ).toEqual([false, false])
    })

    it("stops a creation whose environment fails at the step it reached, holds it, and retries it", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await flush()
      h.env.report(id, "booting")
      h.env.release(id, new Error("image missing"))
      await flush()
      expect(h.pending(id)).toMatchObject({
        operation: { kind: "create", phase: "booting" },
        failure: { message: expect.stringContaining("image missing"), at: expect.any(Number) },
      })
      expect(rows.get(id)?.creationFailure).toMatchObject({ phase: "booting" })
      // Held: the environment's own changes do not prepare it again.
      h.env.changed(id)
      await flush()
      expect(h.env.ensured).toEqual([id])
      await expect(h.backend().lifecycle.retryCreate("zz")).rejects.toThrow("does not exist")
      await h.backend().lifecycle.retryCreate(id)
      expect(h.pending(id)?.failure).toBeUndefined()
      expect(h.pending(id)?.operation).toEqual({ kind: "create", phase: "queued" })
      await flush()
      expect(h.env.ensured).toEqual([id, id])
      h.env.release(id)
      await vi.waitFor(() => expect(h.listed(id)?.mainSessionId).toBeDefined())
    })

    it("stops a creation whose Main cannot start, and starts it on a retry", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      const agents = h.ctx.get("agents") as unknown as typeof h.services.agents
      const create = agents.create
      let refuse = true
      agents.create = async (options) => {
        if (refuse) throw new Error("agent refused")
        return create(options)
      }
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await vi.waitFor(() => expect(h.pending(id)?.failure).toBeDefined())
      expect(h.pending(id)).toMatchObject({
        operation: { kind: "create", phase: "starting-main" },
        failure: { message: expect.stringContaining("agent refused") },
      })
      refuse = false
      await h.backend().lifecycle.retryCreate(id)
      await vi.waitFor(() => expect(h.listed(id)).toBeDefined())
    })

    it("keeps a failed creation failed across a restart, without preparing it", async () => {
      const failed = bot({
        name: "Broken",
        mainSessionId: undefined,
        mainOnBotPreset: undefined,
        creationFailure: { phase: "creating", message: "quota exceeded", at: 5 },
      })
      const rows = new Map<string, BotRecord>([["x", failed]])
      const h = await start(rows)
      await flush()
      expect(h.env.ensured).toEqual([])
      expect(h.pending("x")).toMatchObject({
        name: "Broken",
        operation: { kind: "create", phase: "creating" },
        failure: { message: "quota exceeded", at: 5 },
      })
    })

    it("continues a creation stored before a restart", async () => {
      const rows = new Map<string, BotRecord>([
        ["x", bot({ name: "Half", mainSessionId: undefined, mainOnBotPreset: undefined })],
      ])
      const h = await start(rows)
      await vi.waitFor(() => expect(h.listed("x")?.mainSessionId).toBeDefined())
      expect(h.env.ensured).toEqual(["x"])
    })

    it("keeps a new bot queued while its environment goes away, and creates it with the next one", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], { environment: false })
      const unregister = botOf(h.ctx).registerEnvironment(h.env.environment)
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await flush()
      unregister()
      await flush()
      expect(rows.size).toBe(1)
      expect(h.pending(id)).toMatchObject({ operation: { phase: "queued" } })
      expect(h.pending(id)?.failure).toBeUndefined()
      h.env.state.hold = false
      botOf(h.ctx).registerEnvironment(h.env.environment)
      await vi.waitFor(() => expect(h.listed(id)).toBeDefined())
    })

    it("discards a creation like a deleted bot: listed as removing until its environment is gone", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await flush()
      let finish: () => void = () => {}
      h.env.environment.remove = (botId) =>
        new Promise((resolve) => {
          h.env.removed.push(botId)
          finish = resolve
        })
      await h.backend().lifecycle.discardCreate(id)
      expect(rows.size).toBe(0)
      expect(h.pending(id)).toMatchObject({ operation: { kind: "remove" } })
      await flush()
      expect(h.env.signals[0]?.aborted).toBe(true)
      expect(h.env.removed).toEqual([id])
      expect(h.pending(id)).toMatchObject({ operation: { kind: "remove" } })
      finish()
      await flush()
      expect(h.pending(id)).toBeUndefined()
      expect(h.snapshot()).toEqual({ bots: [], pending: [], preparingSessionIds: [] })
    })

    it("aborts an in-flight creation on unload and keeps it stored", async () => {
      const rows = new Map<string, BotRecord>()
      const h = await start(rows, [], {})
      h.env.state.hold = true
      const id = await h.backend().lifecycle.create({
        name: "New",
        avatar,
        workstation: false,
        language: "en",
        timezone: "Asia/Tokyo",
      })
      await flush()
      await h.fiber.dispose()
      expect(h.env.signals[0]?.aborted).toBe(true)
      expect(rows.get(id)?.creationFailure).toBeUndefined()
    })

    it("unregisters a deleted bot's preset, then removes its environment", async () => {
      const rows = new Map([["a", bot()]])
      const h = await start(rows)
      await flush()
      expect(h.presets.has("bot-a")).toBe(true)
      let registeredAtRemoval: boolean | undefined
      h.env.environment.remove = async (botId) => {
        registeredAtRemoval = h.presets.has(`bot-${botId}`)
        h.env.removed.push(botId)
      }
      await h.backend().lifecycle.remove("a")
      await flush()
      expect(h.env.removed).toEqual(["a"])
      expect(registeredAtRemoval).toBe(false)
      expect(h.pending("a")).toBeUndefined()
    })

    it("accepts a removal at once and lists the bot as removing until its sessions and environment are gone", async () => {
      const h = await start(new Map())
      const created = await h.created()
      let archive: () => void = () => {}
      ;(
        h.ctx.get("workspaceRegistry") as unknown as typeof h.services.workspaceRegistry
      ).archiveSession = () =>
        new Promise<void>((resolve) => {
          archive = resolve
        })
      await expect(h.backend().lifecycle.remove(created.mainSessionId)).rejects.toThrow(
        "does not exist",
      )
      await h.backend().lifecycle.remove(created.id)
      expect(h.listed(created.id)).toBeUndefined()
      expect(h.pending(created.id)).toMatchObject({
        name: "New",
        operation: { kind: "remove" },
        sessionIds: [created.mainSessionId],
      })
      await flush()
      expect(h.env.removed).toEqual([created.id])
      expect(h.pending(created.id)).toBeDefined()
      archive()
      await flush()
      expect(h.pending(created.id)).toBeUndefined()
    })

    it("shows a failed removal until it is retried, or dismissed", async () => {
      const h = await start(new Map())
      const first = await h.created("First")
      const second = await h.created("Second")
      let failing = true
      h.env.environment.remove = async (botId) => {
        if (failing) throw new Error("incus busy")
        h.env.removed.push(botId)
      }
      await h.backend().lifecycle.remove(first.id)
      await h.backend().lifecycle.remove(second.id)
      await flush()
      for (const id of [first.id, second.id]) {
        expect(h.pending(id)).toMatchObject({
          operation: { kind: "remove" },
          failure: { message: expect.stringContaining("incus busy") },
        })
      }
      failing = false
      await h.backend().lifecycle.retryRemove(first.id)
      await flush()
      expect(h.pending(first.id)).toBeUndefined()
      expect(h.env.removed).toEqual([first.id])
      await h.backend().lifecycle.dismissRemove(second.id)
      expect(h.pending(second.id)).toBeUndefined()
      await expect(h.backend().lifecycle.dismissRemove(second.id)).rejects.toThrow(
        "not being removed",
      )
    })

    it("shows a removal whose sessions could not be archived, and archives them on a retry", async () => {
      const h = await start(new Map())
      const created = await h.created()
      let refuse = true
      const archived: string[] = []
      ;(
        h.ctx.get("workspaceRegistry") as unknown as typeof h.services.workspaceRegistry
      ).archiveSession = async (id: string) => {
        if (refuse) throw new Error("session busy")
        archived.push(id)
      }
      await h.backend().lifecycle.remove(created.id)
      await flush()
      expect(h.pending(created.id)?.failure?.message).toContain("session busy")
      expect(h.memberships.has(created.mainSessionId)).toBe(true)
      refuse = false
      await h.backend().lifecycle.retryRemove(created.id)
      await flush()
      expect(archived).toEqual([created.mainSessionId])
      expect(h.memberships.size).toBe(0)
      expect(h.pending(created.id)).toBeUndefined()
    })

    it("records a bot's sessions itself and archives them all when the bot is deleted", async () => {
      const h = await start(new Map())
      const created = await h.created()
      const { sessionId } = await botOf(h.ctx).createSession(created.id)
      expect(h.listed(created.id)?.sessionIds).toEqual([sessionId])
      expect(h.memberships.get(created.mainSessionId)).toMatchObject({ botId: created.id })
      await h.backend().lifecycle.remove(created.id)
      await flush()
      expect(h.log).toContain(`archive ${created.mainSessionId}`)
      expect(h.log).toContain(`archive ${sessionId}`)
      expect(h.memberships.size).toBe(0)
    })

    it("greets only in Main: a New session from the browser and Bot.createSession's stay blank", async () => {
      followups.length = 0
      const h = await start(new Map())
      const created = await h.created()
      await flush()
      expect(followups).toEqual([
        { sessionId: created.mainSessionId, text: "hi New", summary: "New: Main session started" },
      ])
      const starter = starters.at(-1)
      if (starter === undefined) throw new Error("no remote")
      await starter(created.id)
      await botOf(h.ctx).createSession(created.id)
      await flush()
      expect(followups).toHaveLength(1)
      expect(h.snapshot().preparingSessionIds).toEqual([])
    })

    it("lists a New session as being prepared until its environment answers", async () => {
      const h = await start(new Map())
      const created = await h.created()
      await flush()
      h.vmDirs.delete("/home/bot/workspace")
      const starter = starters.at(-1)
      if (starter === undefined) throw new Error("no remote")
      const { sessionId } = await starter(created.id)
      await flush()
      expect(h.snapshot().preparingSessionIds).toEqual([sessionId])
      h.vmDirs.add("/home/bot/workspace")
      await vi.waitFor(() => expect(h.snapshot().preparingSessionIds).toEqual([]), {
        timeout: 5_000,
        interval: 50,
      })
    })

    it("holds the greeting until the bot's environment answers", async () => {
      followups.length = 0
      const h = await start(new Map())
      // The first check fails like the E2E's first SSH connect, the next one answers.
      h.vmDirs.delete("/home/bot/workspace")
      const created = await h.created()
      await flush()
      expect(followups).toEqual([])
      expect(h.snapshot().preparingSessionIds).toEqual([created.mainSessionId])
      h.vmDirs.add("/home/bot/workspace")
      await vi.waitFor(() => expect(followups).toHaveLength(1), { timeout: 5_000, interval: 50 })
      expect(followups[0]?.sessionId).toBe(created.mainSessionId)
      await vi.waitFor(() => expect(h.snapshot().preparingSessionIds).toEqual([]))
    })

    it("fails closed when the environment is unregistered, and recovers on the next one", async () => {
      const rows = new Map([["a", bot()]])
      const h = await start(rows, [], { environment: false })
      const unregister = botOf(h.ctx).registerEnvironment(h.env.environment)
      await flush()
      expect(h.presets.has("bot-a")).toBe(true)
      unregister()
      await flush()
      expect(h.presets.size).toBe(0)
      expect(botOf(h.ctx).presetOf("a")).toMatchObject({ ready: false })
      expect(botOf(h.ctx).environment()).toBeUndefined()
      await expect(botOf(h.ctx).createSession("a")).rejects.toThrow("not ready")
      botOf(h.ctx).registerEnvironment(h.env.environment)
      await flush()
      expect(h.presets.has("bot-a")).toBe(true)
    })

    it("aborts an in-flight ensure on unload", async () => {
      const rows = new Map([["a", bot()]])
      const h = await start(rows, [], { environment: false })
      h.env.state.hold = true
      botOf(h.ctx).registerEnvironment(h.env.environment)
      await flush()
      expect(h.env.signals[0]?.aborted).toBe(false)
      await h.fiber.dispose()
      expect(h.env.signals[0]?.aborted).toBe(true)
    })

    it("refuses Host-execution packages in overlays, even when allowed", async () => {
      const rows = new Map([["a", bot()]])
      const { ctx } = await start(rows, ["@deepseek-ai/dsh-bash-local"])
      await flush()
      const change = {
        overlay: [{ op: "add" as const, row: { id: "x", name: "@deepseek-ai/dsh-bash-local" } }],
      }
      expect(botOf(ctx).previewPreset("a", change)).toMatchObject({
        ok: false,
        problem: expect.stringContaining("runs on the Host"),
      })
      await expect(botOf(ctx).configurePreset("a", change)).rejects.toThrow("runs on the Host")
    })
  })
})

type Bundle = { sandbox: string; approval: string }

/**
 * dsh-permission-presets as far as bot-core relies on it: it pins the
 * profile's default on agent/created with `prepend`, and `set` records the
 * preset, then writes only the knobs that differ.
 */
function presetsFake(table: Record<string, Bundle>, defaultPreset: string) {
  const knobs = (session: FakeAgent["session"]) => ({
    preset: (lastEvent(session, "permission/preset") as { preset: string } | undefined)?.preset,
    sandbox: (lastEvent(session, "sandbox/mode") as { mode: string } | undefined)?.mode,
    approval: (lastEvent(session, "approval/policy") as { policy: string } | undefined)?.policy,
  })
  const current = (session: FakeAgent["session"]) => {
    const state = knobs(session)
    const matches = (name: string) =>
      table[name]?.sandbox === state.sandbox && table[name]?.approval === state.approval
    if (state.preset !== undefined && matches(state.preset)) return state.preset
    return Object.keys(table).find(matches) ?? "custom"
  }
  return class extends Service {
    names = Object.keys(table)
    constructor(ctx: Context) {
      super(ctx, "permissionPresets")
      ctx.on(
        "agent/created" as never,
        (({ agent }: { agent: FakeAgent }) => {
          const state = knobs(agent.session)
          if (state.preset !== undefined || state.sandbox !== undefined) return
          this.set(agent.session, defaultPreset)
        }) as never,
        { prepend: true },
      )
    }
    resolve(name: string): Bundle {
      const spec = table[name]
      if (spec === undefined) throw new Error(`unknown preset "${name}"`)
      return spec
    }
    current = current
    set(session: FakeAgent["session"], name: string) {
      const spec = this.resolve(name)
      const state = knobs(session)
      if (current(session) !== name) session.append("permission/preset", { preset: name })
      if (state.sandbox !== spec.sandbox) session.append("sandbox/mode", { mode: spec.sandbox })
      if (state.approval !== spec.approval)
        session.append("approval/policy", { policy: spec.approval })
    }
  }
}

const DSH_PRESETS: Record<string, Bundle> = {
  "workspace-write": { sandbox: "workspace-write", approval: "ask" },
  "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
}

const permissionEvents = (agent: FakeAgent) =>
  agent.session.events.filter((event) =>
    ["permission/preset", "sandbox/mode", "approval/policy"].includes(event.type),
  )

describe("bot-core permission of bot sessions", () => {
  it("records the bot permission through the knobs' setters without permission presets", async () => {
    const h = await start(new Map([["a", bot()]]))
    await flush()
    const main = await h.announce(h.agent("s1", "bot-a", "bot-a"))
    expect(permissionEvents(main)).toEqual([
      { type: "sandbox/mode", data: { mode: "danger-full-access" } },
      { type: "approval/policy", data: { policy: "never" } },
    ])
    const workspace = await h.announce(h.agent("w1", "standard", "standard"))
    expect(permissionEvents(workspace)).toEqual([])
  })

  it.each(["workspace-write", "danger-full-access"])(
    "records the bot preset over the profile default %s, after the presets pinned it",
    async (profileDefault) => {
      const h = await start(new Map([["a", bot()]]))
      await h.ctx.plugin(presetsFake(DSH_PRESETS, profileDefault))
      await flush()
      const presets = h.ctx.get("permissionPresets") as unknown as { current(s: unknown): string }
      const main = await h.announce(h.agent("s1", "bot-a", "bot-a"))
      expect(presets.current(main.session)).toBe("danger-full-access")
      expect(lastEvent(main.session, "permission/preset")).toEqual({ preset: "danger-full-access" })
      expect(lastEvent(main.session, "sandbox/mode")).toEqual({ mode: "danger-full-access" })
      expect(lastEvent(main.session, "approval/policy")).toEqual({ policy: "never" })
      const workspace = await h.announce(h.agent("w1", "standard", "standard"))
      expect(presets.current(workspace.session)).toBe(profileDefault)
    },
  )

  it("pins subagents, resumes and forks of bot sessions, and writes nothing already recorded", async () => {
    const h = await start(new Map([["a", bot()]]))
    await h.ctx.plugin(presetsFake(DSH_PRESETS, "workspace-write"))
    await flush()
    const main = await h.announce(h.agent("s1", "bot-a", "bot-a"))
    const child = await h.announce(
      h.agent("c1", "bot-a", "bot-a", undefined, { parentSession: "s1", origin: "subagent" }),
    )
    expect(lastEvent(child.session, "approval/policy")).toEqual({ policy: "never" })
    const recorded = permissionEvents(main).length
    h.live.delete("s1")
    await h.announce(main)
    expect(permissionEvents(main)).toHaveLength(recorded)
    const fork = h.agent("f1", "bot-a", "bot-a")
    fork.session.events.push(...main.session.events)
    await h.announce(fork)
    expect(permissionEvents(fork)).toHaveLength(recorded)
  })

  it("pins a blank bot session once it is switched onto its bot's preset", async () => {
    const h = await start(new Map([["a", bot()]]))
    await flush()
    const draft = await h.announce(h.agent("d1", "standard", "bot-a"))
    expect(permissionEvents(draft)).toEqual([])
    await flush()
    expect(draft.preset).toBe("bot-a")
    expect(lastEvent(draft.session, "approval/policy")).toEqual({ policy: "never" })
  })

  it("pins live bot Agents when it loads", async () => {
    const h = await start(new Map([["a", bot()]]))
    await flush()
    const main = await h.announce(h.agent("s1", "bot-a", "bot-a"))
    main.session.events.length = 0
    await h.fiber.dispose()
    await h.load()
    await flush()
    expect(lastEvent(main.session, "sandbox/mode")).toEqual({ mode: "danger-full-access" })
  })

  it("refuses a bot Agent when no permission preset has the bot's bundle", async () => {
    const h = await start(new Map([["a", bot()]]))
    await h.ctx.plugin(
      presetsFake(
        { "workspace-write": DSH_PRESETS["workspace-write"] as Bundle },
        "workspace-write",
      ),
    )
    await flush()
    await expect(h.announce(h.agent("s1", "bot-a", "bot-a"))).rejects.toThrow(
      'no permission preset has sandbox "danger-full-access" with approval "never"',
    )
    await expect(h.announce(h.agent("w1", "standard", "standard"))).resolves.toBeDefined()
  })
})
