import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionsFeed } from "../src/client/connections-model"
import { createConnectorsHub } from "../src/client/connectors-hub"
import {
  ConnectorsError,
  type ConnectorsModel,
  type ConnectorsState,
  createConnectorsModel,
} from "../src/client/connectors-model"
import { createStore } from "../src/client/observable"
import type { BotConnectorsRemote, RemoteMount } from "../src/client/remote"
import { ConnectorsSection } from "../src/client/settings/ConnectorsSection"
import { connectorsBadge } from "../src/client/settings/connectors-badge"
import { accountsDetail, connectorDetail } from "../src/client/settings/connectors-pages"
import type {
  BotConnectionsSnapshot,
  ConnectionProviderView,
  ConnectionView,
} from "../src/shared/connections"
import type {
  BotConnectorChange,
  BotConnectorsSnapshot,
  BotConnectorView,
  ConnectorReadiness,
} from "../src/shared/connectors"
import { bot, t } from "./support/client"
import { idleConnections, probeDescriptor, probeView } from "./support/connectors-client"

const view = probeView()
const snapshot: BotConnectorsSnapshot = { botId: "a", connectors: [view] }
const change: BotConnectorChange = { enabled: true, values: view.values }

function mounted(botConnectors: Partial<BotConnectorsRemote>): Promise<RemoteMount> {
  return Promise.resolve({
    status: "mounted",
    remote: {
      bots: {} as never,
      botFiles: {} as never,
      botChannels: {} as never,
      botInteractions: {} as never,
      botConnectors: botConnectors as BotConnectorsRemote,
      botConnectorActions: {} as never,
      botConnections: {} as never,
      botConnectorStreams: {} as never,
      botWeb: {} as never,
      botManagedSessions: {} as never,
      botWorkspaces: {} as never,
      botMains: {} as never,
      botMainView: {} as never,
      botSkills: {} as never,
      botSettings: {} as never,
      botNotes: {} as never,
      botEnvironment: {} as never,
      botEnvironmentHost: {} as never,
      botOnboarding: {} as never,
      botVaults: {} as never,
    },
  })
}

function streamOf(...snapshots: BotConnectorsSnapshot[]) {
  const dispose = vi.fn()
  return {
    dispose,
    handle: {
      dispose,
      async *[Symbol.asyncIterator]() {
        yield* snapshots
        await new Promise(() => {})
      },
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  expect(error).toBeInstanceOf(ConnectorsError)
  return (error as ConnectorsError).failure
}

const generation = createStore<object | undefined>(undefined)

describe("createConnectorsModel", () => {
  it("follows the bot's snapshots and stops on dispose", async () => {
    const stream = streamOf(snapshot)
    const watch = vi.fn(() => stream.handle)
    const model = createConnectorsModel({ mount: mounted({ watch }), generation }, "a")
    expect(model.getSnapshot()).toEqual({ status: "loading" })
    await settle()
    expect(watch).toHaveBeenCalledWith("a")
    expect(model.getSnapshot()).toEqual({ status: "ready", snapshot })
    model.dispose()
    expect(stream.dispose).toHaveBeenCalled()
  })

  it("reports a failed mount for the stream and every change", async () => {
    const model = createConnectorsModel(
      { mount: Promise.resolve({ status: "failed", error: "no" }), generation },
      "a",
    )
    await settle()
    expect(model.getSnapshot()).toEqual({
      status: "failed",
      failure: { kind: "mount", message: "no" },
    })
    expect((await failure(model.retry("probe"))).kind).toBe("mount")
  })

  it("sends each change for its bot and types the refusals", async () => {
    const configure = vi
      .fn<BotConnectorsRemote["configure"]>()
      .mockResolvedValueOnce({ ok: true, value: view })
      .mockResolvedValueOnce({ ok: false, error: { message: "depth must be an integer" } })
    const setPermission = vi
      .fn<BotConnectorsRemote["setPermission"]>()
      .mockResolvedValueOnce({ ok: false, error: {} })
    const retry = vi.fn<BotConnectorsRemote["retry"]>().mockRejectedValueOnce(new Error("offline"))
    const model = createConnectorsModel(
      {
        mount: mounted({ watch: () => streamOf().handle, configure, setPermission, retry }),
        generation,
      },
      "a",
    )
    await expect(model.configure("probe", change)).resolves.toBe(view)
    expect(configure).toHaveBeenCalledWith("a", "probe", change)
    expect(await failure(model.configure("probe", change))).toEqual({
      kind: "refused",
      message: "depth must be an integer",
    })
    const permission = { connectorId: "probe", tool: "echo", permission: null }
    expect((await failure(model.setPermission(permission))).kind).toBe("protocol")
    expect(setPermission).toHaveBeenCalledWith("a", permission)
    expect(await failure(model.retry("probe"))).toEqual({ kind: "connection", message: "offline" })
    expect(retry).toHaveBeenCalledWith("a", "probe")
    model.dispose()
  })
})

function fakeModel() {
  const state = createStore<ConnectorsState>({ status: "loading" })
  const model: ConnectorsModel & { state: typeof state } = {
    state,
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    configure: vi.fn(async () => view),
    setPermission: vi.fn(async () => view),
    retry: vi.fn(async () => view),
    dispose: vi.fn(),
  }
  return model
}

describe("connectors hub", () => {
  it("shares one stream per bot and closes it after the last subscriber", () => {
    const model = fakeModel()
    const open = vi.fn(() => model)
    const hub = createConnectorsHub(open)
    const feed = hub.feed("a")
    expect(hub.feed("a")).toBe(feed)
    const offA = feed.subscribe(() => {})
    const offB = feed.subscribe(() => {})
    expect(open).toHaveBeenCalledTimes(1)
    model.state.set({ status: "ready", snapshot })
    expect(feed.getSnapshot()).toEqual({ status: "ready", snapshot })
    offA()
    offB()
    expect(model.dispose).toHaveBeenCalledTimes(1)
    expect(feed.getSnapshot()).toEqual({ status: "loading" })
  })

  it("changes through the followed stream and refuses while nothing follows it", async () => {
    const model = fakeModel()
    const feed = createConnectorsHub(() => model).feed("a")
    await expect(feed.retry("probe")).rejects.toThrow(/connectors of "a" are not followed/)
    const off = feed.subscribe(() => {})
    await feed.configure("probe", change)
    await feed.setPermission({ connectorId: "probe", tool: "echo", permission: "ask" })
    await feed.retry("probe")
    expect(model.configure).toHaveBeenCalledWith("probe", change)
    expect(model.setPermission).toHaveBeenCalledWith({
      connectorId: "probe",
      tool: "echo",
      permission: "ask",
    })
    expect(model.retry).toHaveBeenCalledWith("probe")
    off()
  })
})

const readyWith = (...readiness: ConnectorReadiness[]): ConnectorsState => ({
  status: "ready",
  snapshot: {
    botId: "a",
    connectors: readiness.map((state, index) =>
      probeView({
        enabled: state.state !== "disabled",
        readiness: state,
        descriptor: { ...probeDescriptor, id: `c${index}` },
      }),
    ),
  },
})

describe("connectorsBadge", () => {
  const tone = (state: ConnectorsState) => connectorsBadge(state)?.tone

  it("shows nothing while loading, failed to load, or every connector is off", () => {
    expect(connectorsBadge({ status: "loading" })).toBeNull()
    expect(connectorsBadge(readyWith())).toBeNull()
    expect(connectorsBadge(readyWith({ state: "disabled" }))).toBeNull()
  })

  it("shows the worst readiness among the enabled connectors", () => {
    expect(tone(readyWith({ state: "ready", since: 1 }))).toBe("success")
    expect(
      tone(
        readyWith(
          { state: "ready", since: 1 },
          { state: "preparing", since: 1, stage: { kind: "queued", since: 1 } },
        ),
      ),
    ).toBe("pending")
    expect(
      tone(
        readyWith(
          { state: "preparing", since: 1, stage: { kind: "queued", since: 1 } },
          { state: "unavailable", cause: "environment", reason: "x" },
        ),
      ),
    ).toBe("warning")
    expect(
      tone(
        readyWith(
          { state: "unavailable", cause: "environment", reason: "x" },
          { state: "failed", reason: "y", at: 1 },
        ),
      ),
    ).toBe("danger")
    expect(connectorsBadge(readyWith({ state: "ready", since: 1 }))?.label(t)).toBe(
      "settings.badge.ready",
    )
    expect(connectorsBadge(readyWith({ state: "ready", since: 1 }))).toBe(
      connectorsBadge(readyWith({ state: "ready", since: 2 })),
    )
  })
})

const googleProvider: ConnectionProviderView = {
  id: "google",
  name: "Google",
  services: [{ connectorId: "probe", name: "Probe", scopes: [] }],
  client: { clientId: "id", secretSet: true, configured: true },
  callbackPath: "/cb",
  development: true,
}

const alice: ConnectionView = {
  id: "conn-1",
  provider: "google",
  services: ["probe"],
  label: "Alice",
  account: { subject: "1", email: "alice@example.com" },
  grantedScopes: [],
  status: "needs-reauth",
  createdAt: 0,
  authorizedAt: 0,
  bots: ["a"],
}

function readyConnections(snapshot: BotConnectionsSnapshot): ConnectionsFeed {
  return { ...idleConnections(), getSnapshot: () => ({ status: "ready", snapshot }) }
}

describe("ConnectorsSection", () => {
  const render = (
    state: ConnectorsState,
    detail: string | null = null,
    connections: ConnectionsFeed = idleConnections(),
  ) => {
    const model = fakeModel()
    model.state.set(state)
    const hub = createConnectorsHub(() => model)
    const feed = hub.feed("a")
    feed.subscribe(() => {})
    return renderToStaticMarkup(
      createElement(ConnectorsSection, {
        t,
        bot: bot("a", "m"),
        page: { detail, open() {}, back() {} },
        close: () => {},
        confirm: async () => false,
        connectors: hub,
        connections,
        openConnectionSettings: () => {},
        text: (text) => text.en,
      }),
    )
  }
  const SPEC = { cpus: 4, memoryMiB: 6144, diskGiB: 20 }
  const ready = (...connectors: BotConnectorView[]): ConnectorsState => ({
    status: "ready",
    snapshot: { botId: "a", connectors, spec: SPEC },
  })
  const withMemory = (memoryMiB: number, ...connectors: BotConnectorView[]): ConnectorsState => ({
    status: "ready",
    snapshot: { botId: "a", connectors, spec: { ...SPEC, memoryMiB } },
  })

  it("says when no connector is registered, and keeps a row while loading", () => {
    expect(render(ready())).toContain("connectors.none")
    expect(render({ status: "loading" })).toContain("connectors.loading")
  })

  it("lists the connectors on, then off: a switch, the readiness of those on and a way into each, without tags", () => {
    const html = render(
      ready(
        probeView({ descriptor: { ...probeDescriptor, id: "off", sessions: "main" } }),
        probeView({ enabled: true, readiness: { state: "ready", since: 1 } }),
      ),
    )
    expect(html.indexOf("connectors.group.on")).toBeLessThan(html.indexOf("connectors.group.off"))
    expect(html.indexOf('data-dshb-connector="probe"')).toBeLessThan(
      html.indexOf('data-dshb-connector="off"'),
    )
    expect(html).toContain('data-dshb-connector-state="ready"')
    expect(html).toMatch(/aria-checked="true" aria-label="connectors.enabled\(Probe\)"/)
    expect(html).not.toContain("dshb-ui-tag")
    expect(html).not.toContain("GiB")
    expect(html).toContain('class="dshb-ui-row-open"')
    expect(html).not.toContain('type="submit"')
    expect(html).not.toContain("connectors.tools.title")
  })

  it("shows a connector's page: its readiness, settings saved as they change, and its tools", () => {
    const html = render(
      ready(
        probeView({
          enabled: true,
          readiness: { state: "failed", reason: "apt is locked", at: 1, retryAt: 2 },
          overrides: { echo: "ask" },
        }),
      ),
      connectorDetail("probe"),
    )
    expect(html).toContain('data-dshb-connector-detail="probe"')
    expect(html).toContain('data-dshb-connector-readiness="failed"')
    expect(html).toContain("connectors.detail.failed")
    expect(html).toContain("apt is locked")
    expect(html).toContain("data-dshb-connector-retry")
    expect(html).toContain('value="hello"')
    expect(html).toContain("connectors.range(1,9)")
    expect(html).toMatch(/<select[^>]*data-dshb-connector-field="mode"/)
    expect(html).toMatch(/aria-checked="false" aria-label="Slow"/)
    expect(html).toContain("connectors.tools.title(3)")
    expect(html).toMatch(
      /data-dshb-connector-tool="probe_echo" data-effective="ask" data-overridden=""/,
    )
    expect(html).toContain("data-dshb-connector-tool-reset")
    expect(html).toContain("data-dshb-connector-reset-all")
    expect(html).toContain('title="connectors.permission.default"')
    expect(html).not.toContain("data-dshb-connector-tools-filter")
    expect(html).not.toContain('type="submit"')
  })

  it("cannot turn on a connector the bot's VM has too little memory for, and points at the VM page", () => {
    const html = render(withMemory(3072, probeView()))
    expect(html).toMatch(/<button[^>]*aria-label="connectors\.enabled\(Probe\)"[^>]*disabled/)
    expect(html).toContain('data-dshb-connector-switch-block="spec"')
    expect(html).toContain("connectors.switch.spec.memoryMiB(environment.value.gib(4))")
    expect(render(withMemory(4096, probeView()))).not.toContain("data-dshb-connector-switch-block")
    expect(render(withMemory(3072, probeView({ enabled: true })))).not.toContain(
      "data-dshb-connector-switch-block",
    )
  })

  describe("with a connector that requires another", () => {
    const desk = (enabled: boolean) =>
      probeView({ enabled, descriptor: { ...probeDescriptor, id: "desk", name: "Desk" } })
    const web = (enabled: boolean) =>
      probeView({
        enabled,
        descriptor: { ...probeDescriptor, id: "web", name: "Web", requires: ["desk"] },
      })
    const switchOf = (html: string, name: string) =>
      html.match(
        new RegExp(`<button[^>]*aria-label="connectors\\.enabled\\(${name}\\)"[^>]*>`),
      )?.[0]

    it("cannot turn it on while what it requires is off, and says why", () => {
      const html = render(ready(desk(false), web(false)))
      expect(switchOf(html, "Web")).toContain("disabled")
      expect(switchOf(html, "Desk")).not.toContain("disabled")
      expect(html).toContain('data-dshb-connector-switch-block="requirements-off"')
      expect(html).toContain("connectors.switch.requirementsOff(Web,Desk)")
      const page = render(ready(desk(false), web(false)), connectorDetail("web"))
      expect(switchOf(page, "Web")).toContain("disabled")
      expect(page).toContain("connectors.switch.requirementsOff(Web,Desk)")
    })

    it("cannot turn off what it requires while it is on, and says why", () => {
      const html = render(ready(desk(true), web(true)))
      expect(switchOf(html, "Desk")).toContain("disabled")
      expect(switchOf(html, "Web")).not.toContain("disabled")
      expect(html).toContain("connectors.switch.required(Desk,Web)")
      const page = render(ready(desk(true), web(true)), connectorDetail("desk"))
      expect(page).toContain('data-dshb-connector-switch-block="required"')
    })

    it("may turn either off or on when it was stored on while what it requires is off", () => {
      const html = render(ready(desk(false), web(true)))
      expect(switchOf(html, "Web")).not.toContain("disabled")
      expect(switchOf(html, "Desk")).not.toContain("disabled")
      expect(html).not.toContain("data-dshb-connector-switch-block")
    })

    it("cannot turn it on while what it requires is not installed", () => {
      const html = render(ready(web(false)))
      expect(switchOf(html, "Web")).toContain("disabled")
      expect(html).toContain("connectors.switch.requirementsMissing(Web,desk)")
    })
  })

  it("filters a long tool list", () => {
    const tools = Array.from({ length: 12 }, (_, index) => ({
      name: `t${index}`,
      toolName: `probe_t${index}`,
      description: "A tool.",
      permission: "allow" as const,
    }))
    const many = probeView({ descriptor: { ...probeDescriptor, tools } })
    const html = render(ready(many), connectorDetail("probe"))
    expect(html).toContain("data-dshb-connector-tools-filter")
    expect(html.match(/data-dshb-connector-tool="/g)).toHaveLength(12)
  })

  it("heads the list with the providers' accounts, a row of the same height while they load", () => {
    const google = probeView({
      descriptor: { ...probeDescriptor, connections: { provider: "google", scopes: [] } },
    })
    expect(render(ready(google))).toContain("connections.standing.loading")
    const html = render(
      ready(google),
      null,
      readyConnections({ providers: [googleProvider], connections: [alice], attempts: [] }),
    )
    expect(html).toContain('data-dshb-provider="google"')
    expect(html).toContain('data-dshb-provider-standing="reauth"')
    expect(html).toContain("connections.count.one(1)")
    expect(html).toContain("connectors.accounts.none")
  })

  it("shows a provider's page: the bot's accounts with their switch and menu, and Add account", () => {
    const google = probeView({
      descriptor: { ...probeDescriptor, connections: { provider: "google", scopes: [] } },
    })
    const html = render(
      ready(google),
      accountsDetail("google"),
      readyConnections({ providers: [googleProvider], connections: [alice], attempts: [] }),
    )
    expect(html).toContain('data-dshb-accounts-page="google"')
    expect(html).toContain("connections.dev")
    expect(html).toContain('data-dshb-account="alice@example.com" data-status="needs-reauth"')
    expect(html).toContain("alice@example.com · connections.bots.one(1)")
    expect(html).toMatch(/aria-checked="true"[^>]*data-dshb-account-assign/)
    expect(html).toContain("data-dshb-account-menu")
    expect(html).toContain("data-dshb-connections-add")
    expect(html).not.toContain("data-dshb-connections-setup")
    const unset = render(
      ready(google),
      accountsDetail("google"),
      readyConnections({
        providers: [{ ...googleProvider, client: { secretSet: false, configured: false } }],
        connections: [],
        attempts: [],
      }),
    )
    expect(unset).toContain("data-dshb-connections-setup")
    expect(unset).toContain("connections.standing.unconfigured")
    expect(unset).not.toContain("data-dshb-connections-add")
  })
})
