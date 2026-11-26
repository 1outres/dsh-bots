import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BotsFace } from "../src/client/face"
import type { FilesFace } from "../src/client/files/files-face"
import type { DshSettingsPageFace } from "../src/client/global-settings/DshSettingsPage"
import { DshSettingsPage } from "../src/client/global-settings/DshSettingsPage"
import {
  GlobalSettingsScreen,
  type GlobalSettingsScreenFace,
} from "../src/client/global-settings/GlobalSettingsScreen"
import { apply } from "../src/client/index"
import type { RegistrationStatus } from "../src/client/session-classification"
import { SETTINGS_SECTION } from "../src/client/settings/builtin"
import { SettingsScreen, type SettingsScreenFace } from "../src/client/settings/SettingsScreen"
import type { ShellFace } from "../src/client/shell/face"
import { ShellRoot } from "../src/client/shell/ShellRoot"
import { BOT_FILE_TAB_ID } from "../src/client/sidebar/file-tab"
import { RefusedFileTab } from "../src/client/sidebar/RefusedFileTab"
import { SessionRightbar } from "../src/client/sidebar/SessionRightbar"
import { BOT_SESSION_PRIORITY } from "../src/client/slot-priority"
import type {
  ClientContext,
  Observable,
  RemoteContribution,
  SessionListState,
  SessionSummary,
  WorkspaceSnapshot,
} from "../src/client/types"
import type { BotsSnapshot, BotView } from "../src/shared/bots"
import type { BotChannelsSnapshot } from "../src/shared/channels"
import type { BotDirectoryListing } from "../src/shared/files"
import type { BotInteractionsSnapshot } from "../src/shared/interactions"
import { botPresetId } from "../src/shared/preset"
import { REMOTE_PACKAGE } from "../src/shared/remote-contract"

/** The browser half's apply() against a fake client context: how its registrations follow the sessions. */

function value<T>(initial: T): Observable<T> & { set(next: T): void } {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next) {
      current = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** The `bots` Remote's watch stream, fed by the test. */
function channel() {
  const queue: BotsSnapshot[] = []
  let wake: (() => void) | undefined
  let closed = false
  return {
    push(snapshot: BotsSnapshot) {
      queue.push(snapshot)
      wake?.()
    },
    handle: {
      async *[Symbol.asyncIterator]() {
        while (!closed) {
          const next = queue.shift()
          if (next !== undefined) {
            yield next
            continue
          }
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
      dispose() {
        closed = true
        wake?.()
      },
    },
  }
}

const bot: BotView = {
  id: "x",
  name: "Bot x",
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  mainSessionId: "m1",
  mainStartedAt: 0,
  sessionIds: ["s1"],
  formerMainIds: [],
  timezone: "UTC",
  createdAt: 0,
}

const LISTED: BotsSnapshot = { bots: [bot], pending: [], preparingSessionIds: [] }

const summary = (id: string, agentPreset: string | null): SessionSummary => ({
  id,
  displayTitle: id,
  running: false,
  blank: false,
  updatedAt: 0,
  projectionValues: { agentPreset },
})

/** A ready session list whose summaries carry each session's agent preset. */
const sessionList = (presets: Readonly<Record<string, string | null>>): SessionListState => ({
  phase: "ready",
  ids: Object.keys(presets),
  byId: Object.fromEntries(
    Object.entries(presets).map(([id, preset]) => [id, summary(id, preset)]),
  ),
})

interface Registration {
  options: Record<string, unknown>
  component: unknown
  live: boolean
}

function injectedBy<T>(registration: Registration | undefined): T {
  if (registration === undefined) throw new Error("not registered")
  return (registration.options.inject as () => T)()
}

interface FakeOptions {
  /** Provide DSH's right sidebar services (ctx.inject runs its callback). */
  sidebar?: boolean
  /** Make `ctx.remote.$mount` reject every contribution with this error. */
  mountFailure?: Error
}

/**
 * `ctx.remote` as typert and the Gateway have it: a package registers one
 * contribution, and each namespace it names becomes the `remote.<namespace>` service.
 */
function typertRemote(faces: Readonly<Record<string, unknown>>, failure?: Error) {
  const contributions: RemoteContribution[] = []
  const services = new Map<string, unknown>()
  return {
    contributions,
    get: (name: string) => services.get(name),
    remote: {
      async $mount(contribution: RemoteContribution) {
        if (failure !== undefined) throw failure
        contributions.push(contribution)
        for (const { namespace } of contribution.descriptors) {
          services.set(`remote.${namespace}`, faces[namespace])
        }
        return async () => {}
      },
    },
  }
}

/** Single Slots, as ui-slots SlotCore has them: `entriesOfSlot` lists only the head (the lowest priority), and an equal priority is refused. */
const SINGLE = new Set([
  "main.conversation",
  "rightbar.session",
  "conversation.session.header.corner",
  "conversation.input.model",
  "conversation.input.permission",
])

const priorityOf = (options: Record<string, unknown>) => Number(options.priority ?? 0)

/** `message` as SlotCore words a refusal at bot-core's priority by `registrant`. */
const refusedBy = (name: string, registrant: string) =>
  `single slot "${name}" already has a registration at priority ${BOT_SESSION_PRIORITY} (registered by ${registrant})`

function fakeContext(options: FakeOptions = {}) {
  const cleanups: (() => void)[] = []
  const registrations: Registration[] = []
  const attempts: Record<string, unknown>[] = []
  const stream = channel()
  const current = value<{ key?: unknown }>({})
  const sessions = value<SessionListState>({ phase: "pending", ids: [], byId: {} })
  const workspaces = value<WorkspaceSnapshot>({
    phase: "pending",
    items: [],
    archivedSessionIds: [],
  })
  const generation = value<object | undefined>({})
  const listing: BotDirectoryListing = {
    path: "",
    entries: [{ name: "notes.md", type: "file" }],
    truncated: false,
  }
  const botFiles = { list: vi.fn(async () => ({ ok: true as const, value: listing })) }
  const channelsSnapshot: BotChannelsSnapshot = { botId: "x", channels: [] }
  const botChannels = {
    watch: vi.fn(() => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield channelsSnapshot
      },
    })),
    configure: vi.fn(),
  }
  const interactionWatches: string[] = []
  const interactionSnapshot: BotInteractionsSnapshot = {
    sessionId: "m1",
    open: [
      {
        interaction: {
          id: "i1",
          kind: "approval",
          subject: "bash",
          question: { en: "Run it?" },
          actions: ["allow-once", "reject"],
          delegated: false,
        },
      },
    ],
    closed: [],
    channelNames: {},
  }
  const botConnectors = {
    watch: vi.fn((botId: string) => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { botId, connectors: [] }
        await new Promise(() => {})
      },
    })),
  }
  const botConnectorActions = {
    watch: vi.fn((botId: string) => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { botId, actions: [] }
        await new Promise(() => {})
      },
    })),
    watchWaiting: vi.fn(() => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { waiting: { x: 2 } }
        await new Promise(() => {})
      },
    })),
    decide: vi.fn(async () => ({
      ok: true as const,
      value: { accepted: false, reason: "not-found" },
    })),
  }
  const botConnections = {
    watch: vi.fn(() => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { providers: [], connections: [], attempts: [] }
        await new Promise(() => {})
      },
    })),
  }
  const botWeb = {
    watch: vi.fn(() => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        await new Promise(() => {})
      },
    })),
  }
  const botManagedSessions = {
    watch: vi.fn(() => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { sessions: [] }
        await new Promise(() => {})
      },
    })),
  }
  const botInteractions = {
    watch: vi.fn((sessionId: string) => {
      interactionWatches.push(sessionId)
      return {
        dispose() {},
        async *[Symbol.asyncIterator]() {
          yield { ...interactionSnapshot, sessionId }
          await new Promise(() => {})
        },
      }
    }),
    answer: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    hold: vi.fn(),
  }
  const pending: {
    interaction: { key: string; kind: string; sessionId: string }
    live: boolean
  }[] = []
  const layoutToggles = vi.fn()
  const registerPendingInteraction = vi.fn(
    () => (interaction: { key: string; kind: string; sessionId: string }) => {
      const entry = { interaction, live: true }
      pending.push(entry)
      return () => {
        entry.live = false
      }
    },
  )
  const typert = typertRemote(
    {
      bots: { watch: () => stream.handle },
      botFiles,
      botChannels,
      botInteractions,
      botConnectors,
      botConnectorActions,
      botConnections,
      botConnectorStreams: { open: vi.fn() },
      botWeb,
      botManagedSessions,
      botWorkspaces: {
        watch: vi.fn(() => ({
          dispose() {},
          async *[Symbol.asyncIterator]() {
            yield { grants: [], workspaces: [] }
            await new Promise(() => {})
          },
        })),
      },
      botMains: { watch: vi.fn(), watchDefaults: vi.fn() },
      botMainView: { watch: vi.fn() },
      botSkills: { watch: vi.fn() },
      botNotes: { watch: vi.fn() },
      botEnvironment: { watch: vi.fn() },
      botEnvironmentHost: { watch: vi.fn() },
      botOnboarding: {
        watch: vi.fn(() => ({
          dispose() {},
          async *[Symbol.asyncIterator]() {
            yield { version: "0.3.0", welcome: { status: "done" }, releaseNotes: [] }
            await new Promise(() => {})
          },
        })),
      },
      botVaults: {
        watch: vi.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield { providers: [], accounts: [], openIncidents: {} }
            await new Promise(() => {})
          },
          dispose() {},
        })),
        watchBot: vi.fn(),
      },
    },
    options.mountFailure,
  )
  const tabTypes: { id: string; canOpen(address: string): boolean }[] = []
  const sidebarRight = { closeIn: vi.fn(), tabDomain: { occurrence: vi.fn() } }
  const sidebarRightTabs = {
    register(definition: { id: string; canOpen(address: string): boolean }) {
      tabTypes.push(definition)
      return () => {
        tabTypes.splice(tabTypes.indexOf(definition), 1)
      }
    },
  }
  const listeners = new Map<string, Set<() => void>>()
  const notify = (key: string) => {
    // Microtask-batched, as the slot registry notifies.
    queueMicrotask(() => {
      for (const listener of [...(listeners.get(key) ?? [])]) listener()
    })
  }
  const register = (options_: Record<string, unknown>, component: unknown) => {
    const name = String(options_.name)
    if (options_.priority !== undefined) attempts.push(options_)
    const priority = priorityOf(options_)
    const held = SINGLE.has(name)
      ? registrations.find(
          (item) =>
            item.live && item.options.name === name && priorityOf(item.options) === priority,
        )
      : undefined
    if (held !== undefined) {
      const by =
        held.options.registrant === undefined
          ? ""
          : ` (registered by ${String(held.options.registrant)})`
      throw new Error(
        `single slot "${name}" already has a registration at priority ${priority}${by}`,
      )
    }
    const registration = { options: options_, component, live: true }
    registrations.push(registration)
    notify(name)
    return () => {
      registration.live = false
      notify(name)
    }
  }
  const ctx = {
    effect(effect: () => (() => void) | undefined) {
      const cleanup = effect()
      if (cleanup !== undefined) cleanups.push(cleanup)
    },
    get: typert.get,
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register,
      entriesOfSlot(key: string) {
        const live = registrations
          .filter((item) => item.live && item.options.name === key)
          .map(
            (item) =>
              ({ ...item.options, component: item.component }) as {
                component: unknown
                priority?: number
                store?: unknown
              },
          )
        if (!SINGLE.has(key)) return live
        const head = [...live].sort((x, y) => priorityOf(x) - priorityOf(y))[0]
        return head === undefined ? [] : [head]
      },
      subscribe(key: string, listener: () => void) {
        const set = listeners.get(key) ?? new Set()
        set.add(listener)
        listeners.set(key, set)
        return () => {
          set.delete(listener)
        }
      },
    },
    inject(
      deps: readonly string[],
      callback: (child: ClientContext & Record<string, unknown>) => void,
    ) {
      if (!options.sidebar) return
      expect(deps).toEqual(["sidebarRight", "sidebarRightTabs"])
      callback({ ...ctx, sidebarRight, sidebarRightTabs })
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      resolveText: (text: { readonly en: string }) => text.en,
      getSnapshot: () => ({ active: "en", locales: [{ id: "en", label: "English" }] }),
    },
    contextMenus: { active: value(null), register: () => () => {}, open() {}, close() {} },
    remote: typert.remote,
    connection: { generation },
    sessions: { list: sessions, create: async () => "" },
    workspaces: { list: workspaces },
    uiWorkspace: {
      openSession() {},
      startSession() {},
      archiveSession: async () => {},
      unarchiveSession: async () => {},
    },
    uiSession: { adapter: { current }, registerPendingInteraction },
    layout: { toggleSidebar: layoutToggles },
  } satisfies ClientContext
  const named = (name: string) =>
    registrations.filter((registration) => registration.options.name === name)
  const shells = () => named("main.conversation")
  const live = () => shells().filter((registration) => registration.live)
  /** DSH's ui-sidebar-right registering its seat and ExpandButton with one store handle. */
  const registerDsh = (store: object) => {
    const offs = [
      register({ name: "rightbar.session", store }, "RightbarSeat"),
      register({ name: "conversation.session.header.corner", store }, "ExpandButton"),
    ]
    return () => {
      for (const off of offs) off()
    }
  }
  const section = () => injectedBy<BotsFace>(named("sidebar.session.action")[0])
  const shellFace = () => injectedBy<ShellFace>(live()[0])
  const lockdowns = () =>
    named("rightbar.session").filter((item) => item.live && item.component === SessionRightbar)
  return {
    ctx,
    typert,
    botFiles,
    botChannels,
    botConnectors,
    botConnectorActions,
    channelsSnapshot,
    botInteractions,
    interactionWatches,
    pending,
    registerPendingInteraction,
    layoutToggles,
    registerDsh,
    tabTypes,
    named,
    attempts,
    stream,
    current,
    sessions,
    workspaces,
    generation,
    shells,
    live,
    section,
    shellFace,
    lockdowns,
    dispose: () => {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const stubBrowser = (storage: Map<string, string>) => {
  vi.stubGlobal("document", {
    createElement: () => ({ dataset: {}, textContent: "", remove() {} }),
    head: { append() {} },
    body: { children: [] },
    querySelector: () => null,
  })
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, text: string) => storage.set(key, text),
  })
}

describe("client apply(): the bot session shell", () => {
  let storage: Map<string, string>
  beforeEach(() => {
    storage = new Map()
    stubBrowser(storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("holds main.conversation at the bot session priority while the main view shows a bot or unclassified session", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    // Restoring: no session yet while DSH's lists are pending, so neither DSH's home nor a header.
    expect(fake.live()).toHaveLength(1)
    expect(fake.shellFace().classification.getSnapshot()).toEqual({ kind: "unknown" })

    // Nothing tells yet what m1 is: the neutral placeholder, never DSH's header.
    fake.current.set({ key: "m1" })
    expect(fake.live()).toHaveLength(1)
    const [shell] = fake.live()
    expect(shell?.component).toBe(ShellRoot)
    expect(shell?.options).toMatchObject({
      name: "main.conversation",
      priority: BOT_SESSION_PRIORITY,
      locale: "bot-core",
      children: { "bot-core.connector.panel": { kind: "keyed", scope: "session" } },
    })
    expect(Object.keys(fake.shellFace()).sort()).toEqual(
      [
        "actionsWidth",
        "approvals",
        "bots",
        "classification",
        "clearError",
        "connectorPanels",
        "files",
        "incidents",
        "lockdownNotice",
        "mainView",
        "menu",
        "notes",
        "openSettings",
        "panels",
        "pending",
        "popoverHost",
        "popovers",
        "progress",
        "rightbarRegistration",
        "settingsStack",
        "status",
      ].sort(),
    )
    expect(fake.shellFace().classification.getSnapshot()).toEqual({ kind: "unknown" })

    fake.stream.push(LISTED)
    await settle()
    expect(fake.shellFace().classification.getSnapshot()).toMatchObject({
      kind: "bot",
      bot,
      source: "bots",
    })

    // Another session of the same bot keeps the registration.
    fake.current.set({ key: "s1" })
    expect(fake.shells()).toHaveLength(1)
    // A Workspace session: released, so DSH's ConversationRoot renders it.
    fake.current.set({ key: "w1" })
    expect(fake.live()).toEqual([])
    fake.current.set({ key: "m1" })
    expect(fake.live()).toHaveLength(1)
    expect(fake.section().registrations.shell.getSnapshot()).toEqual({ state: "active" })

    // No session memory in localStorage: the bots list and the presets decide.
    expect([...storage.keys()]).toEqual([])
    fake.dispose()
    expect(fake.live()).toEqual([])
  })

  const COMPOSER_SEATS = [
    { seat: "modelSeat", slot: "conversation.input.model", dsh: "ModelSelect" },
    { seat: "permissionSeat", slot: "conversation.input.permission", dsh: "PermissionSelect" },
  ] as const

  for (const { seat, slot, dsh } of COMPOSER_SEATS) {
    it(`empties the composer's ${slot} seat over DSH's control while the main view shows a bot session`, async () => {
      const fake = fakeContext()
      apply(fake.ctx)
      fake.ctx.slots.register({ name: slot }, dsh)
      const head = () => fake.ctx.slots.entriesOfSlot(slot)[0]
      fake.current.set({ key: "m1" })
      fake.stream.push(LISTED)
      await settle()
      expect(head()).toMatchObject({ name: slot, priority: BOT_SESSION_PRIORITY })
      expect(head()?.component).not.toBe(dsh)
      expect(fake.section().registrations[seat].getSnapshot()).toEqual({ state: "active" })

      fake.current.set({ key: "w1" })
      expect(head()?.component).toBe(dsh)
      expect(fake.section().registrations[seat].getSnapshot()).toEqual({ state: "idle" })
      fake.current.set({ key: "s1" })
      expect(head()?.priority).toBe(BOT_SESSION_PRIORITY)
      fake.dispose()
      expect(head()?.component).toBe(dsh)
    })

    for (const order of ["before", "after"] as const) {
      it(`empties the ${slot} seat over a plugin's replacement held at -100, registered ${order} bot-core`, async () => {
        const fake = fakeContext()
        const holdReplacement = () =>
          fake.ctx.slots.register({ name: slot, priority: -100, registrant: "WC" }, "PluginControl")
        fake.ctx.slots.register({ name: slot }, dsh)
        if (order === "before") holdReplacement()
        apply(fake.ctx)
        fake.current.set({ key: "m1" })
        fake.stream.push(LISTED)
        await settle()
        if (order === "after") holdReplacement()
        const head = () => fake.ctx.slots.entriesOfSlot(slot)[0]
        expect(head()).toMatchObject({ priority: BOT_SESSION_PRIORITY })
        expect(fake.section().registrations[seat].getSnapshot()).toEqual({ state: "active" })

        fake.current.set({ key: "w1" })
        expect(head()?.component).toBe("PluginControl")
        fake.current.set({ key: "s1" })
        expect(head()).toMatchObject({ priority: BOT_SESSION_PRIORITY })
        expect(fake.section().registrations[seat].getSnapshot()).toEqual({ state: "active" })
        fake.dispose()
        expect(head()?.component).toBe("PluginControl")
      })
    }

    it(`reports a refused ${slot} seat without touching the other composer seat`, async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const fake = fakeContext()
      fake.ctx.slots.register(
        { name: slot, priority: BOT_SESSION_PRIORITY, registrant: "WC" },
        "PluginControl",
      )
      apply(fake.ctx)
      fake.current.set({ key: "m1" })
      fake.stream.push(LISTED)
      await settle()
      expect(fake.section().registrations[seat].getSnapshot()).toEqual({
        state: "refused",
        error: refusedBy(slot, "WC"),
      })
      expect(error).toHaveBeenCalledTimes(1)
      for (const other of COMPOSER_SEATS.filter((item) => item.seat !== seat)) {
        expect(fake.section().registrations[other.seat].getSnapshot()).toEqual({ state: "active" })
      }
      fake.dispose()
    })
  }

  it("takes the shell and the right sidebar over plugins that replace them at -100", async () => {
    const fake = fakeContext({ sidebar: true })
    fake.registerDsh({ create() {} })
    for (const name of ["main.conversation", "rightbar.session"]) {
      fake.ctx.slots.register({ name, priority: -100, registrant: "WC" }, `Plugin ${name}`)
    }
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    const head = (name: string) => fake.ctx.slots.entriesOfSlot(name)[0]?.component
    expect(head("main.conversation")).toBe(ShellRoot)
    expect(head("rightbar.session")).toBe(SessionRightbar)
    expect(fake.section().registrations.shell.getSnapshot()).toEqual({ state: "active" })
    expect(fake.section().registrations.rightbar.getSnapshot()).toEqual({ state: "active" })

    fake.current.set({ key: "w1" })
    expect(head("main.conversation")).toBe("Plugin main.conversation")
    expect(head("rightbar.session")).toBe("Plugin rightbar.session")
    fake.dispose()
  })

  it("leaves a genuinely blank home to DSH once its lists have arrived without a session", () => {
    const fake = fakeContext()
    apply(fake.ctx)
    expect(fake.live()).toHaveLength(1)
    fake.sessions.set(sessionList({}))
    expect(fake.live()).toHaveLength(1)
    fake.workspaces.set({ phase: "ready", items: [], archivedSessionIds: [] })
    expect(fake.live()).toEqual([])
    fake.dispose()
  })

  it("classifies from the agent preset until the bots list arrives, which then decides", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    fake.sessions.set(sessionList({ m1: null, w1: null, w2: botPresetId("x") }))

    // A legacy Main on the default preset reads as stock until the list says otherwise.
    fake.current.set({ key: "m1" })
    expect(fake.live()).toEqual([])
    // A Workspace session on the bot's preset reads as the bot's, provisionally.
    fake.current.set({ key: "w2" })
    expect(fake.live()).toHaveLength(1)
    expect(fake.shellFace().classification.getSnapshot()).toEqual({
      kind: "bot",
      botId: "x",
      bot: undefined,
      source: "preset",
    })
    fake.current.set({ key: "w1" })
    expect(fake.live()).toEqual([])

    fake.stream.push(LISTED)
    await settle()
    fake.current.set({ key: "w2" })
    expect(fake.live()).toEqual([])
    fake.current.set({ key: "m1" })
    expect(fake.live()).toHaveLength(1)
    fake.dispose()
  })

  it("tries the bot session priority once: a refusal is logged, final, and shown in the Bots section", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = fakeContext()
    fake.ctx.slots.register(
      { name: "main.conversation", priority: BOT_SESSION_PRIORITY, registrant: "Other" },
      "OtherShell",
    )
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    expect(fake.live().filter((item) => item.component === ShellRoot)).toEqual([])
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain(`priority ${BOT_SESSION_PRIORITY}`)
    const status = fake.section().registrations.shell.getSnapshot()
    expect(status).toEqual({ state: "refused", error: refusedBy("main.conversation", "Other") })

    fake.current.set({ key: "w1" })
    fake.current.set({ key: "s1" })
    const tried = fake.attempts.filter(
      (options) => options.name === "main.conversation" && options.registrant === undefined,
    )
    expect(tried.map((options) => options.priority)).toEqual([BOT_SESSION_PRIORITY])
    fake.dispose()
  })

  it("locks the right sidebar of a bot session with the header corner's store handle", async () => {
    const handle = { create() {} }
    const fake = fakeContext({ sidebar: true })
    fake.registerDsh(handle)
    apply(fake.ctx)
    // The tab type and its refusal-only body are registered up front.
    expect(fake.tabTypes.map((type) => type.id)).toEqual([BOT_FILE_TAB_ID])
    const [tab] = fake.named("sidebar.right.pane.tab")
    expect(tab?.component).toBe(RefusedFileTab)
    expect(tab?.options.inject).toBeUndefined()

    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    expect(fake.lockdowns()).toHaveLength(1)
    expect(fake.lockdowns()[0]?.options).toMatchObject({
      priority: BOT_SESSION_PRIORITY,
      store: handle,
      locale: "bot-core",
    })
    const inject = fake.lockdowns()[0]?.options.inject as () => Record<string, unknown>
    expect(Object.keys(inject()).sort()).toEqual([
      "classify",
      "handle",
      "lockdown",
      "openExternal",
      "sidebar",
      "viewer",
    ])
    expect(inject().handle).toBe("present")
    expect(fake.shellFace().files.linksAvailable.getSnapshot()).toBe(true)
    expect(fake.section().registrations.rightbar.getSnapshot()).toEqual({ state: "active" })
    // canOpen follows the classification: a bot session's file yes, a Workspace session's no.
    const [type] = fake.tabTypes
    expect(type?.canOpen("dsh-resource://file/session/s1/a.md")).toBe(true)
    expect(type?.canOpen("dsh-resource://file/session/w1/a.md")).toBe(false)

    // A Workspace session: DSH's own sidebar.
    fake.current.set({ key: "w1" })
    expect(fake.lockdowns()).toEqual([])
    // Back on the bot session: the handle is still the corner's, though our entry heads rightbar.session.
    fake.current.set({ key: "m1" })
    expect(fake.lockdowns()[0]?.options.store).toBe(handle)
    fake.dispose()
    expect(fake.tabTypes).toEqual([])
    expect(fake.lockdowns()).toEqual([])
  })

  it("picks up DSH's store handle registered after bot-core, and a new one when DSH re-registers", async () => {
    const fake = fakeContext({ sidebar: true })
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    // rightbar.session held, DSH's seat not registered yet: locked, without a store.
    expect(fake.lockdowns()).toHaveLength(1)
    expect(fake.lockdowns()[0]?.options.store).toBeUndefined()
    const files = (): FilesFace => fake.shellFace().files
    expect(files().linksAvailable.getSnapshot()).toBe(false)

    const first = { create() {} }
    const offDsh = fake.registerDsh(first)
    await settle()
    expect(fake.lockdowns()).toHaveLength(1)
    expect(fake.lockdowns()[0]?.options).toMatchObject({
      store: first,
      priority: BOT_SESSION_PRIORITY,
    })
    expect(files().linksAvailable.getSnapshot()).toBe(true)

    // DSH's effect re-runs with a fresh handle: re-registered with it.
    offDsh()
    const second = { create() {} }
    fake.registerDsh(second)
    await settle()
    expect(fake.lockdowns()).toHaveLength(1)
    expect(fake.lockdowns()[0]?.options.store).toBe(second)
    fake.dispose()
    expect(fake.lockdowns()).toEqual([])
  })

  it("fails closed without DSH's store handle: the sidebar stays ours and links say they cannot open", async () => {
    const fake = fakeContext({ sidebar: true })
    // DSH's seat without its corner button (a DSH change): nothing to borrow.
    fake.ctx.slots.register({ name: "rightbar.session" }, "RightbarSeat")
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    expect(fake.lockdowns()).toHaveLength(1)
    const [lockdown] = fake.lockdowns()
    expect(lockdown?.options.store).toBeUndefined()
    expect(injectedBy<{ handle: string }>(lockdown).handle).toBe("missing")
    expect(fake.shellFace().files.linksAvailable.getSnapshot()).toBe(false)
    fake.dispose()
  })

  it("shows a refused lockdown in the shell and the Bots section, with links unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = fakeContext({ sidebar: true })
    fake.registerDsh({ create() {} })
    fake.ctx.slots.register(
      { name: "rightbar.session", priority: BOT_SESSION_PRIORITY, registrant: "Other" },
      "OtherRightbar",
    )
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    const refused: RegistrationStatus = {
      state: "refused",
      error: refusedBy("rightbar.session", "Other"),
    }
    expect(fake.shellFace().rightbarRegistration.getSnapshot()).toEqual(refused)
    expect(fake.section().registrations.rightbar.getSnapshot()).toEqual(refused)
    expect(fake.shellFace().files.linksAvailable.getSnapshot()).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    fake.dispose()
  })

  it("leaves the right sidebar alone without DSH's sidebar services", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    fake.current.set({ key: "m1" })
    fake.stream.push(LISTED)
    await settle()
    expect(fake.named("rightbar.session")).toEqual([])
    expect(fake.live()).toHaveLength(1)
    expect(fake.shellFace().files.linksAvailable.getSnapshot()).toBe(false)
    expect(fake.section().registrations.rightbar.getSnapshot()).toEqual({ state: "idle" })
    fake.dispose()
  })
})

describe("client apply(): bot-core's Remote", () => {
  beforeEach(() => stubBrowser(new Map()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("follows the shown bot session's interactions and takes the composer seat above DSH's cards", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    fake.stream.push(LISTED)
    await settle()
    expect(fake.registerPendingInteraction).toHaveBeenCalledTimes(1)
    const [[precedence]] = fake.registerPendingInteraction.mock.calls as unknown as [[() => number]]
    expect(precedence()).toBeGreaterThan(2)
    expect(fake.interactionWatches).toEqual([])
    fake.current.set({ key: "m1" })
    await settle()
    expect(fake.interactionWatches).toEqual(["m1"])
    const live = fake.pending.filter((entry) => entry.live)
    expect(live.map((entry) => entry.interaction)).toEqual([
      expect.objectContaining({
        kind: "bot-core.interaction",
        sessionId: "m1",
        interactionId: "i1",
      }),
    ])
    const [composer] = fake.named("conversation.composer")
    const select = composer?.options.select as (owner: object) => unknown
    expect(select({ sessionId: "m1", pendingInteraction: live[0]?.interaction })).toBe(
      live[0]?.interaction,
    )
    expect(select({ sessionId: "m1", pendingInteraction: { kind: "question" } })).toBeNull()
    expect(composer?.options.priority).toBe(BOT_SESSION_PRIORITY)
    fake.current.set({ key: "w1" })
    await settle()
    expect(fake.pending.filter((entry) => entry.live)).toEqual([])
    fake.dispose()
  })

  it("mounts one contribution carrying the bots, botFiles and botChannels namespaces, read by the section and the viewer", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    await settle()
    expect(fake.typert.contributions).toHaveLength(1)
    const [contribution] = fake.typert.contributions
    expect(contribution?.package).toBe(REMOTE_PACKAGE)
    expect(new Set(contribution?.descriptors.map((descriptor) => descriptor.namespace))).toEqual(
      new Set([
        "bots",
        "botFiles",
        "botChannels",
        "botInteractions",
        "botConnectors",
        "botConnectorActions",
        "botConnections",
        "botConnectorStreams",
        "botWeb",
        "botManagedSessions",
        "botWorkspaces",
        "botMains",
        "botMainView",
        "botSkills",
        "botNotes",
        "botEnvironment",
        "botEnvironmentHost",
        "botOnboarding",
        "botVaults",
      ]),
    )

    fake.stream.push(LISTED)
    await settle()
    expect(fake.section().bots.getSnapshot()).toEqual({ status: "ready", snapshot: LISTED })
    expect(fake.section().waiting.getSnapshot()).toEqual({ x: 2 })
    const feed = fake.shellFace().approvals.feed("x")
    const off = feed.subscribe(() => {})
    await settle()
    expect(fake.botConnectorActions.watch).toHaveBeenCalledWith("x")
    expect(feed.getSnapshot()).toEqual({ status: "ready", actions: [], reconnecting: false })
    off()
    fake.current.set({ key: "m1" })
    const tree = fake.shellFace().files.treeOf("m1")
    tree.load()
    await settle()
    expect(tree.getSnapshot().entries.map((entry) => entry.name)).toEqual(["notes.md"])
    expect(fake.botFiles.list).toHaveBeenCalledWith("m1", "", expect.any(AbortSignal))
    fake.dispose()
  })

  it("opens a bot's settings from the section and the shell, with its channels read through the same contribution", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    fake.stream.push(LISTED)
    await settle()
    const overlay = fake
      .named("shell.overlay")
      .find((registration) => registration.options.id === "bot-core.settings")
    expect(overlay?.component).toBe(SettingsScreen)
    const face = injectedBy<SettingsScreenFace>(overlay)
    expect(face.sections.getSnapshot().map((section) => section.id)).toEqual([
      SETTINGS_SECTION.general,
      "bot-core.mains",
      SETTINGS_SECTION.models,
      SETTINGS_SECTION.workspaces,
      SETTINGS_SECTION.channels,
      "bot-core.environment",
      SETTINGS_SECTION.connectors,
      "bot-core.logins",
      "bot-core.skills",
    ])
    expect(face.flow.target.getSnapshot()).toBeNull()

    fake.section().openSettings("x")
    expect(face.flow.target.getSnapshot()).toEqual({
      botId: "x",
      section: SETTINGS_SECTION.general,
      detail: null,
      nav: true,
    })
    face.flow.close()
    fake.current.set({ key: "m1" })
    fake.shellFace().openSettings("x")
    expect(face.flow.target.getSnapshot()?.botId).toBe("x")

    const sectionOf = (id: string) => face.sections.getSnapshot().find((item) => item.id === id)
    const badge = sectionOf(SETTINGS_SECTION.channels)?.badge?.("x")
    const off = badge?.subscribe(() => {})
    await settle()
    expect(fake.botChannels.watch).toHaveBeenCalledWith("x")
    expect(badge?.getSnapshot()).toBeNull()
    off?.()
    const connectorsBadge = sectionOf(SETTINGS_SECTION.connectors)?.badge?.("x")
    const offConnectors = connectorsBadge?.subscribe(() => {})
    await settle()
    expect(fake.botConnectors.watch).toHaveBeenCalledWith("x")
    expect(connectorsBadge?.getSnapshot()).toBeNull()
    offConnectors?.()

    fake.stream.push({ bots: [], pending: [], preparingSessionIds: [] })
    await settle()
    expect(face.flow.target.getSnapshot()).toBeNull()
    fake.dispose()
  })

  it("opens the dsh-bots settings from the Bots section, its page in DSH's settings, and over a bot's settings", async () => {
    const fake = fakeContext()
    apply(fake.ctx)
    fake.stream.push(LISTED)
    await settle()
    const overlay = fake
      .named("shell.overlay")
      .find((registration) => registration.options.id === "bot-core.global-settings")
    expect(overlay?.component).toBe(GlobalSettingsScreen)
    const global = injectedBy<GlobalSettingsScreenFace>(overlay)
    expect(global.sections.getSnapshot().map((section) => section.id)).toEqual([
      "bot-core.web",
      "bot-core.vm-host",
      "bot-core.mains",
      "bot-core.connections",
      "bot-core.vaults",
    ])
    expect(global.flow.target.getSnapshot()).toBeNull()

    const [page] = fake.named("settings.section")
    if (page === undefined) throw new Error("no DSH settings page")
    expect(page.component).toBe(DshSettingsPage)
    expect(page.options).toMatchObject({ id: "dsh-bots", order: 70, locale: "bot-core" })
    expect((page.options.label as () => string)()).toBe("dshSettings.nav")
    const home = { section: "bot-core.web", detail: null, nav: true }
    injectedBy<DshSettingsPageFace>(page).openGlobalSettings()
    expect(global.flow.target.getSnapshot()).toEqual(home)
    expect(global.stack.getSnapshot()).toEqual(["global"])
    global.flow.close()

    fake.section().openGlobalSettings()
    expect(global.flow.target.getSnapshot()).toEqual(home)
    fake.section().openSettings("x", SETTINGS_SECTION.connectors)
    const bots = injectedBy<SettingsScreenFace>(
      fake
        .named("shell.overlay")
        .find((registration) => registration.options.id === "bot-core.settings"),
    )
    expect(global.flow.target.getSnapshot()).toBeNull()
    expect(bots.flow.target.getSnapshot()?.botId).toBe("x")

    bots.flow.edits.hold()
    fake.section().openGlobalSettings()
    expect(bots.flow.guard.getSnapshot().leaving).toBeNull()
    expect(global.flow.target.getSnapshot()).toEqual(home)
    expect(bots.stack.getSnapshot()).toEqual(["bot", "global"])
    global.flow.close()
    expect(bots.stack.getSnapshot()).toEqual(["bot"])
    expect(bots.flow.target.getSnapshot()?.section).toBe(SETTINGS_SECTION.connectors)
    expect(bots.flow.guard.getSnapshot().pending).toBe(true)

    fake.section().openGlobalSettings()
    fake.section().openSettings("x", SETTINGS_SECTION.general)
    expect(global.flow.target.getSnapshot()).toBeNull()
    expect(bots.flow.guard.getSnapshot().leaving).toBe("move")
    bots.flow.discard()
    expect(bots.flow.target.getSnapshot()?.section).toBe(SETTINGS_SECTION.general)
    fake.dispose()
  })

  it("reports a failed mount: logged with its cause, and final for the bots and the files", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const cause = new Error('typert: Remote package "@1outres/dsh-bot-core" is already registered')
    const fake = fakeContext({ mountFailure: cause })
    apply(fake.ctx)
    await settle()
    expect(error).toHaveBeenCalledWith("bot-core: mounting the Remote failed", cause)
    expect(fake.section().bots.getSnapshot()).toEqual({ status: "failed", error: cause.message })

    // Unclassifiable without a list or a session summary: the shell holds the view.
    fake.current.set({ key: "m1" })
    const tree = fake.shellFace().files.treeOf("m1")
    tree.load()
    await settle()
    expect(tree.getSnapshot().directories[""]).toEqual({
      status: "failed",
      failure: { kind: "mount", message: cause.message },
    })
    expect(fake.botFiles.list).not.toHaveBeenCalled()
    fake.dispose()
  })
})
