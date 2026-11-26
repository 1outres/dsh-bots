import { describe, expect, it } from "vitest"
import type { EnvironmentStatus } from "../src/host/environment"
import type { SessionModel } from "../src/host/models/models"
import { createTemplateCatalog } from "../src/host/preset/catalog"
import { BOT_CORE_ROW_IDS, FILES_ROW_ID } from "../src/host/preset/compose"
import { type BotPresetSource, createPresetRealizer } from "../src/host/preset/realize"
import { createBotSessions } from "../src/host/preset/session"
import type { ComposedPreset, EnvironmentLayer } from "../src/host/preset/types"
import type { BotTemplate, PluginRow } from "../src/shared/preset"

function template(id: string, rows: string[] = ["persona"], hostTools: string[] = []): BotTemplate {
  return {
    id,
    plugins: rows.map((row) => ({ id: row, name: `@x/${row}` }) as PluginRow),
    hostTools,
  }
}

function rowsOf(preset: ComposedPreset): readonly PluginRow[] {
  return groupRowsOf(preset).filter((row) => !BOT_CORE_ROW_IDS.includes(row.id))
}

function groupRowsOf(preset: ComposedPreset | undefined): readonly PluginRow[] {
  const [group] = preset?.plugins ?? []
  if (group?.id !== "bot-environment") throw new Error("the preset is not inside the environment")
  return group.config as PluginRow[]
}

function fakeRegistry() {
  const live = new Map<string, ComposedPreset>()
  const log: string[] = []
  let failRegister: string | undefined
  const broken = new Map<string, string>()
  return {
    live,
    log,
    broken,
    failNext(message: string) {
      failRegister = message
    },
    async register(preset: ComposedPreset) {
      if (failRegister !== undefined) {
        const message = failRegister
        failRegister = undefined
        throw new Error(message)
      }
      if (live.has(preset.id)) throw new Error(`Duplicate agent preset: ${preset.id}`)
      live.set(preset.id, preset)
      log.push(
        `register ${preset.id} ${rowsOf(preset)
          .map((row) => row.id)
          .join(",")}`,
      )
      let disposed = false
      return async () => {
        if (disposed) return
        disposed = true
        if (live.get(preset.id) === preset) live.delete(preset.id)
        log.push(`unregister ${preset.id}`)
        await Promise.resolve()
      }
    },
    diagnose: async (id: string): Promise<string | undefined> => broken.get(id),
  }
}

function manualClock() {
  let tasks: { work: () => void; at: number; cancelled: boolean }[] = []
  let now = 0
  return {
    later(work: () => void, ms: number) {
      const task = { work, at: now + ms, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    async tick(ms = 0) {
      now += ms
      const due = tasks.filter((task) => task.at <= now)
      tasks = tasks.filter((task) => task.at > now)
      for (const task of due) if (!task.cancelled) task.work()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    },
    pending: () => tasks.filter((task) => !task.cancelled).length,
  }
}

function fakeEnvironment() {
  const statuses = new Map<string, EnvironmentStatus>()
  let layer: EnvironmentLayer | undefined = { id: "vm", isolate: [], rows: [] }
  return {
    statuses,
    setLayer(next: EnvironmentLayer | undefined) {
      layer = next
    },
    layer: (target: { id: string; name: string }) =>
      layer === undefined
        ? undefined
        : {
            ...layer,
            rows: layer.rows.map((row) => ({
              ...row,
              config: { ...(row.config as object), bot: target.id },
            })),
          },
    status: (botId: string): EnvironmentStatus => statuses.get(botId) ?? { ready: true },
  }
}

function setup(bots: Record<string, BotPresetSource> = {}) {
  const catalog = createTemplateCatalog()
  catalog.register(template("default"))
  const records = new Map(Object.entries(bots))
  const registry = fakeRegistry()
  const warnings: string[] = []
  const changed: string[] = []
  const clock = manualClock()
  const environment = fakeEnvironment()
  const realizer = createPresetRealizer({
    catalog,
    source: (id) => records.get(id),
    botIds: () => records.keys(),
    allowedHostTools: new Set(["ask", "web_fetch"]),
    web: () => ({ backend: "exa", search: true, fetch: true }),
    environment,
    seal: (revision) => `sealed:${revision}`,
    register: (preset) => registry.register(preset),
    diagnose: (id) => registry.diagnose(id),
    later: clock.later,
    warn: (message) => warnings.push(message),
    graceMs: 1000,
    settleMs: 10,
    duplicateRetryMs: 50,
  })
  realizer.subscribe((id) => changed.push(id))
  return { catalog, records, registry, realizer, warnings, changed, clock, environment }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe("createPresetRealizer", () => {
  it("registers every bot's composed preset", async () => {
    const { realizer, registry, changed } = setup({ a: { name: "A" }, b: { name: "B" } })
    expect(realizer.state("a")).toMatchObject({
      ready: false,
      pending: true,
      problem: expect.stringContaining("not registered yet"),
    })
    await realizer.refreshAll()
    expect([...registry.live.keys()].sort()).toEqual(["bot-a", "bot-b"])
    expect(registry.live.get("bot-a")?.name).toBe("Bot: A")
    expect(realizer.state("a")).toEqual({ id: "bot-a", ready: true, template: "default" })
    expect(changed.sort()).toEqual(["a", "b"])
  })

  it("leaves an unchanged composition registered", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    await realizer.refresh("a")
    await realizer.refresh("a", { retry: true })
    expect(registry.log).toEqual(["register bot-a persona"])
  })

  it("does not re-mount a preset when only the bot's name changes", async () => {
    const { realizer, registry, records } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    records.set("a", { name: "Renamed" })
    await realizer.refresh("a")
    expect(registry.log).toEqual(["register bot-a persona"])
  })

  it("swaps a changed composition in place", async () => {
    const { realizer, registry, records } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    records.set("a", { name: "A", overlay: [{ op: "add", row: { id: "web", name: "@x/web" } }] })
    await realizer.refresh("a")
    expect(registry.log).toEqual([
      "register bot-a persona",
      "unregister bot-a",
      "register bot-a persona,web",
    ])
    expect(realizer.state("a")?.ready).toBe(true)
    expect(realizer.registration("a")?.revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it("serializes one bot's work: a session never sees the swap gap", async () => {
    const { realizer, registry, records } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    records.set("a", { name: "A", overlay: [{ op: "add", row: { id: "web", name: "@x/web" } }] })
    const seen: (string | undefined)[] = []
    const swap = realizer.refresh("a")
    const work = realizer.run("a", async (state) => {
      seen.push(
        registry.live
          .get(state.id)
          ?.plugins.flatMap((row) =>
            (row.config as PluginRow[])
              .map((inner) => inner.id)
              .filter((id) => !BOT_CORE_ROW_IDS.includes(id)),
          )
          .join(","),
      )
      return state.ready
    })
    await expect(work).resolves.toBe(true)
    await swap
    expect(seen).toEqual(["persona,web"])
  })

  it("holds a missing template as pending, warns only after the grace period, recovers", async () => {
    const { realizer, registry, records, catalog, warnings, clock } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    records.set("a", { name: "A", template: "helper" })
    const state = await realizer.refresh("a")
    expect(state).toEqual({
      id: "bot-a",
      ready: false,
      template: "helper",
      problem: 'template "helper" is not registered',
      pending: true,
    })
    expect(registry.live.has("bot-a")).toBe(false)
    expect(warnings).toEqual([])
    await clock.tick(1000)
    expect(warnings).toEqual([expect.stringContaining("still not usable")])
    catalog.register(template("helper", ["persona", "tool"]))
    await clock.tick(10)
    await realizer.run("a", async () => undefined)
    expect(realizer.state("a")).toEqual({ id: "bot-a", ready: true, template: "helper" })
    const preset = registry.live.get("bot-a")
    expect(preset === undefined ? [] : rowsOf(preset).map((row) => row.id)).toEqual([
      "persona",
      "tool",
    ])
  })

  it("does not warn when a template arrives within the grace period (start-up)", async () => {
    const { realizer, catalog, warnings, clock } = setup({ a: { name: "A", template: "helper" } })
    await realizer.refreshAll()
    expect(realizer.state("a")).toMatchObject({ ready: false, pending: true })
    catalog.register(template("helper"))
    await clock.tick(10)
    await settle()
    await clock.tick(1000)
    expect(realizer.state("a")).toMatchObject({ ready: true })
    expect(warnings).toEqual([])
  })

  it("coalesces a template's unregister and re-register (a reconfigured row)", async () => {
    const { realizer, registry, catalog, clock } = setup({ a: { name: "A", template: "helper" } })
    const first = catalog.register(template("helper"))
    await realizer.refreshAll()
    registry.log.length = 0
    first()
    catalog.register(template("helper"))
    await clock.tick(10)
    await settle()
    expect(registry.log).toEqual([])
    expect(realizer.state("a")).toMatchObject({ ready: true })
  })

  it("recomposes only the bots on a changed template", async () => {
    const { realizer, registry, catalog, clock } = setup({
      a: { name: "A", template: "helper" },
      b: { name: "B" },
    })
    catalog.register(template("helper"))
    await realizer.refreshAll()
    registry.log.length = 0
    catalog.register(template("other"))
    await clock.tick(10)
    await settle()
    expect(registry.log).toEqual([])
  })

  it("does not keep the old registration when the overlay stops applying", async () => {
    const { realizer, registry, records, changed } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    changed.length = 0
    records.set("a", { name: "A", overlay: [{ op: "remove", id: "nope" }] })
    const state = await realizer.refresh("a")
    expect(state).toMatchObject({ ready: false, problem: expect.stringContaining('"nope"') })
    expect(registry.live.size).toBe(0)
    expect(changed).toEqual(["a"])
  })

  it("reports a malformed stored overlay instead of throwing", async () => {
    const { realizer, records } = setup({ a: { name: "A" } })
    records.set("a", { name: "A", overlay: [{ op: "future-op", id: "x" }] })
    expect(await realizer.refresh("a")).toMatchObject({
      ready: false,
      problem: expect.stringContaining("the stored overlay is not usable"),
    })
  })

  it("reports a registration failure and retries it only on request", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    registry.failNext("boom")
    expect(await realizer.refresh("a")).toMatchObject({
      ready: false,
      problem: "registration failed: boom",
    })
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(await realizer.refresh("a", { retry: true })).toMatchObject({ ready: true })
  })

  it("notifies when a swap's new registration throws (the old one is gone)", async () => {
    const { realizer, registry, records, changed } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    changed.length = 0
    records.set("a", { name: "A", overlay: [{ op: "add", row: { id: "web", name: "@x/web" } }] })
    registry.failNext("boom")
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(realizer.registration("a")).toBeUndefined()
    expect(changed).toEqual(["a"])
  })

  it("retries a Duplicate refusal later instead of remembering it (a reload)", async () => {
    const { realizer, registry, clock } = setup({ a: { name: "A" } })
    registry.live.set("bot-a", { id: "bot-a", name: "old", order: 1, plugins: [] })
    expect(await realizer.refresh("a")).toMatchObject({
      ready: false,
      problem: expect.stringContaining("retrying"),
    })
    registry.live.delete("bot-a")
    await clock.tick(50)
    await settle()
    expect(realizer.state("a")).toMatchObject({ ready: true })
  })

  it("never shows an empty problem while a registration is being checked", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    let release: () => void = () => {}
    registry.diagnose = (id: string) =>
      new Promise((resolve) => {
        release = () => resolve(registry.broken.get(id))
      })
    const pending = realizer.refresh("a")
    await settle()
    expect(realizer.state("a")).not.toMatchObject({ problem: "" })
    release()
    await pending
    expect(realizer.state("a")).toMatchObject({ ready: true })
  })

  it("unregisters a preset the registry reports broken", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    registry.broken.set("bot-a", "row 1: plugin not found")
    expect(await realizer.refresh("a")).toMatchObject({
      ready: false,
      problem: "row 1: plugin not found",
    })
    expect(registry.live.size).toBe(0)
    expect(registry.log).toEqual(["register bot-a persona", "unregister bot-a"])
  })

  it("drops a removed bot's registration but keeps recognizing it", async () => {
    const { realizer, registry, records } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    records.delete("a")
    await realizer.refreshAll()
    expect(registry.live.size).toBe(0)
    expect(realizer.state("a")).toBeUndefined()
    expect(realizer.registration("a")).toBeUndefined()
    expect(realizer.isBot("a")).toBe(true)
    expect(realizer.isBot("zz")).toBe(false)
  })

  it("reports host tools of registered presets only", async () => {
    const { realizer, records, catalog } = setup({ a: { name: "A", template: "helper" } })
    catalog.register(template("helper", ["persona"], ["web_fetch", "web_fetch", "ask"]))
    await realizer.refresh("a")
    expect(realizer.registration("a")?.hostTools).toEqual(["ask", "web_fetch"])
    records.set("a", { name: "A", template: "missing" })
    await realizer.refresh("a")
    expect(realizer.registration("a")).toBeUndefined()
  })

  it("checks and previews a change without registering it", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    expect(realizer.check("a", { name: "A", template: "nope" })).toMatchObject({ ok: false })
    expect(realizer.preview("a", { name: "A", overlay: [{ op: "remove", id: "x" }] })).toEqual({
      ok: false,
      template: "default",
      problem: expect.stringContaining('"x"'),
    })
    expect(realizer.preview("a", { name: "A" })).toEqual({
      ok: true,
      template: "default",
      hostTools: [],
    })
    expect(registry.live.size).toBe(0)
  })

  it("waits in settled() for queued work and a pending template, up to the timeout", async () => {
    const { realizer, catalog, clock } = setup({ a: { name: "A", template: "helper" } })
    void realizer.refreshAll()
    let done = false
    void realizer.settled("a", 500).then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    catalog.register(template("helper"))
    await clock.tick(10)
    await settle()
    await settle()
    expect(done).toBe(true)
    const other = setup({ b: { name: "B", template: "never" } })
    await other.realizer.refreshAll()
    let gaveUp = false
    void other.realizer.settled("b", 500).then(() => {
      gaveUp = true
    })
    await settle()
    expect(gaveUp).toBe(false)
    await other.clock.tick(500)
    await settle()
    expect(gaveUp).toBe(true)
  })

  it("registers a preset only while its environment is ready, pending without a warning", async () => {
    const { realizer, registry, environment, warnings, clock } = setup({ a: { name: "A" } })
    environment.statuses.set("a", { ready: false, problem: "preparing", pending: true })
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(realizer.state("a")).toEqual({
      id: "bot-a",
      ready: false,
      template: "default",
      problem: "preparing",
      pending: true,
    })
    await clock.tick(5000)
    expect(warnings).toEqual([])
    environment.statuses.delete("a")
    await realizer.refresh("a")
    expect(registry.live.has("bot-a")).toBe(true)
    environment.statuses.set("a", { ready: false, problem: "vm broken" })
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(realizer.state("a")).toMatchObject({ ready: false, problem: "vm broken" })
    expect(realizer.state("a")).not.toHaveProperty("pending")
    expect(realizer.registration("a")).toBeUndefined()
  })

  it("registers nothing without an environment layer, but still checks the configuration", async () => {
    const { realizer, registry, environment } = setup({ a: { name: "A" } })
    environment.setLayer(undefined)
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(realizer.registration("a")).toBeUndefined()
    expect(realizer.state("a")).toMatchObject({
      ready: false,
      problem: "the preset is not inside the bot's environment",
    })
    expect(realizer.check("a", { name: "A" })).toEqual({ ok: true, hostTools: [] })
    expect(realizer.check("a", { name: "A", overlay: [{ op: "remove", id: "x" }] })).toMatchObject({
      ok: false,
    })
  })

  it("checks a configuration against the environment's layer once one is registered", () => {
    const { realizer, environment } = setup({ a: { name: "A" } })
    environment.setLayer({ id: "vm", isolate: ["custom"], rows: [{ id: "env-fs", name: "@x/fs" }] })
    const isolating = {
      op: "add" as const,
      row: { id: "own", name: "@x/own", isolate: { custom: true } },
    }
    expect(realizer.check("a", { name: "A", overlay: [isolating] })).toMatchObject({
      ok: false,
      problem: expect.stringContaining('isolates "custom"'),
    })
  })

  it("registers the sealed token its preset's files row carries", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    await realizer.refresh("a")
    const token = realizer.registration("a")?.revisionToken
    expect(token).toMatch(/^sealed:[0-9a-f]{64}$/)
    const files = groupRowsOf(registry.live.get("bot-a")).find((row) => row.id === FILES_ROW_ID)
    expect(files?.config).toEqual({
      botId: "a",
      token,
    })
  })

  it("waits in settled() while the environment is pending", async () => {
    const { realizer, environment } = setup({ a: { name: "A" } })
    environment.statuses.set("a", { ready: false, problem: "preparing", pending: true })
    await realizer.refresh("a")
    let done = false
    void realizer.settled("a", 1000).then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    environment.statuses.delete("a")
    await realizer.refresh("a")
    await settle()
    expect(done).toBe(true)
  })

  it("wraps the composition in the environment's group; its rows are part of the revision", async () => {
    const { realizer, registry, environment, records } = setup({
      a: { name: "A" },
    })
    environment.setLayer({
      id: "vm",
      isolate: ["fs", "custom"],
      rows: [{ id: "env-fs", name: "@x/fs" }],
    })
    await realizer.refresh("a")
    const preset = registry.live.get("bot-a")
    expect(preset?.plugins).toEqual([
      {
        id: "bot-environment",
        name: "cordis:group",
        group: true,
        isolate: expect.objectContaining({ fs: true, shell: true, custom: true, ptcRuntime: true }),
        config: [
          { id: "env-fs", name: "@x/fs", config: { bot: "a" } },
          {
            id: "env-bot-core-files",
            name: "@1outres/dsh-bot-core/files",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-channel",
            name: "@1outres/dsh-bot-core/channel",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-connectors",
            name: "@1outres/dsh-bot-core/connectors",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-vaults",
            name: "@1outres/dsh-bot-core/vaults",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-vault-guard",
            name: "@1outres/dsh-bot-core/vault-guard",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-schedule",
            name: "@1outres/dsh-bot-core/schedule",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-sessions",
            name: "@1outres/dsh-bot-core/sessions",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-peers",
            name: "@1outres/dsh-bot-core/peers",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-prompt",
            name: "@1outres/dsh-bot-core/prompt",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-notes",
            name: "@1outres/dsh-bot-core/notes",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          { id: "env-bot-core-skill", name: "@deepseek-ai/dsh-skill" },
          {
            id: "env-bot-core-skills",
            name: "@1outres/dsh-bot-core/skills",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-conversations",
            name: "@1outres/dsh-bot-core/conversations",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-settings",
            name: "@1outres/dsh-bot-core/settings",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          {
            id: "env-bot-core-web",
            name: "@deepseek-ai/dsh-web",
            config: { searchProvider: "bot-core", fetchProvider: "bot-core" },
          },
          {
            id: "env-bot-core-web-bridge",
            name: "@1outres/dsh-bot-core/web",
            config: {
              botId: "a",
              token: realizer.registration("a")?.revisionToken,
              backend: "exa",
              search: true,
              fetch: true,
            },
          },
          { id: "env-bot-core-present", name: "@deepseek-ai/dsh-tool-present" },
          {
            id: "env-bot-core-compaction",
            name: "@1outres/dsh-bot-core/compaction",
            config: { botId: "a", token: realizer.registration("a")?.revisionToken },
          },
          { id: "persona", name: "@x/persona" },
        ],
      },
    ])
    const revision = realizer.registration("a")?.revision
    records.set("a", { name: "Renamed" })
    await realizer.refresh("a")
    expect(realizer.registration("a")?.revision).toBe(revision)
    environment.setLayer({ id: "vm", isolate: ["fs"], rows: [{ id: "env-fs", name: "@x/fs" }] })
    await realizer.refresh("a")
    expect(realizer.registration("a")?.revision).not.toBe(revision)
    expect(registry.log.filter((line) => line.startsWith("register"))).toHaveLength(2)
  })

  it("reports an environment whose rows cannot be read", async () => {
    const { realizer, registry, environment } = setup({ a: { name: "A" } })
    environment.layer = () => {
      throw new Error("no rows")
    }
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(realizer.state("a")).toMatchObject({
      ready: false,
      problem: expect.stringContaining("no rows"),
    })
  })

  it("rejects run for an unknown bot", async () => {
    const { realizer } = setup()
    await expect(realizer.run("zz", async () => 1)).rejects.toThrow("does not exist")
  })

  it("unregisters everything on dispose and registers nothing afterwards", async () => {
    const { realizer, registry, clock } = setup({ a: { name: "A" }, b: { name: "B" } })
    await realizer.refreshAll()
    await realizer.dispose()
    expect(registry.live.size).toBe(0)
    await realizer.refresh("a")
    expect(registry.live.size).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  it("disposes a registration that lands after dispose", async () => {
    const { realizer, registry } = setup({ a: { name: "A" } })
    const pending = realizer.refresh("a")
    const disposed = realizer.dispose()
    await pending
    await disposed
    expect(registry.live.size).toBe(0)
  })
})

describe("createBotSessions", () => {
  function sessions(
    options: { workspace?: string | null; returned?: string; failRename?: boolean } = {},
  ) {
    const ctx = setup({ a: { name: "A" } })
    const created: { cwd: string; agentPreset: string; model: SessionModel }[] = []
    const adopted: [string, string][] = []
    const prepared: string[] = []
    const renamed: [string, string][] = []
    const warnings: string[] = []
    const api = createBotSessions({
      realizer: ctx.realizer,
      exists: (id) => id === "a",
      workspace: () =>
        options.workspace === null ? undefined : (options.workspace ?? "/home/bot/workspace"),
      model: async () => ({ kind: "fixed", selection: { provider: "p", model: "m" } }),
      create: async (request) => {
        created.push(request)
        return {
          sessionId: `s${created.length}`,
          agentPreset: options.returned ?? request.agentPreset,
        }
      },
      adopt: async (botId, sessionId) => {
        adopted.push([botId, sessionId])
      },
      prepare: (sessionId) => prepared.push(sessionId),
      rename: async (sessionId, title) => {
        if (options.failRename) throw new Error("no title")
        renamed.push([sessionId, title])
      },
      warn: (message) => warnings.push(message),
    })
    return { ...ctx, api, created, adopted, prepared, renamed, warnings }
  }

  it("creates the session in the environment's workspace under the bot's preset, records it and prepares it", async () => {
    const { api, created, adopted, prepared, renamed, registry } = sessions()
    await expect(api.create("a", { title: " Hello " })).resolves.toEqual({ sessionId: "s1" })
    expect(registry.live.has("bot-a")).toBe(true)
    expect(created).toEqual([
      {
        cwd: "/home/bot/workspace",
        agentPreset: "bot-a",
        model: { kind: "fixed", selection: { provider: "p", model: "m" } },
      },
    ])
    expect(adopted).toEqual([["a", "s1"]])
    expect(prepared).toEqual(["s1"])
    expect(renamed).toEqual([["s1", "Hello"]])
  })

  it("creates nothing without an environment workspace", async () => {
    const { api, created } = sessions({ workspace: null })
    await expect(api.create("a")).rejects.toThrow("no bot environment")
    expect(created).toEqual([])
  })

  it("rejects while the preset is not ready and creates nothing", async () => {
    const { api, created, records } = sessions()
    records.set("a", { name: "A", template: "missing" })
    await expect(api.create("a")).rejects.toThrow('template "missing" is not registered')
    expect(created).toEqual([])
  })

  it("retries a failed registration before deciding", async () => {
    const { api, realizer, registry } = sessions()
    registry.failNext("transient")
    await realizer.refresh("a")
    await expect(api.create("a")).resolves.toEqual({ sessionId: "s1" })
  })

  it("rejects an unknown bot", async () => {
    const { api } = sessions()
    await expect(api.create("zz")).rejects.toThrow("does not exist")
  })

  it("keeps a session whose title failed, with a warning", async () => {
    const { api, warnings } = sessions({ failRename: true })
    await expect(api.create("a", { title: "x" })).resolves.toEqual({ sessionId: "s1" })
    expect(warnings).toEqual([expect.stringContaining("could not title")])
  })

  it("flags a session composed from another preset, still recorded as the bot's", async () => {
    const { api, adopted } = sessions({ returned: "standard" })
    await expect(api.create("a")).rejects.toThrow('composed from "standard"')
    expect(adopted).toEqual([["a", "s1"]])
  })
})
