import { Context, Service } from "@deepseek-ai/cordis"
import { Group, Loader } from "@deepseek-ai/cordis-plugin-loader"
import { describe, expect, it } from "vitest"
import { composeBotPreset, FILES_ROW_ID, FILES_ROW_PLUGIN } from "../src/host/preset/compose"
import { ATTACH_ENVIRONMENT_SERVICES, type BotEnvironmentServices } from "../src/internal"
import BotEnvironmentFiles from "../src/plugins/files"
import type { BotOverlay, BotTemplate, PluginRow } from "../src/shared/preset"

function tagged(name: string) {
  return class extends Service {
    kind: string
    constructor(ctx: Context, config: { kind: string }) {
      super(ctx, name)
      this.kind = config.kind
    }
  }
}

interface Attach {
  readonly botId: string
  readonly token: string
  readonly services: BotEnvironmentServices
  detached: boolean
}

function botService(attached: Attach[]) {
  return class extends Service {
    constructor(ctx: Context) {
      super(ctx, "bot")
    }
    [ATTACH_ENVIRONMENT_SERVICES](botId: string, token: string, services: BotEnvironmentServices) {
      const entry: Attach = { botId, token, services, detached: false }
      attached.push(entry)
      return () => {
        entry.detached = true
      }
    }
  }
}

const kindOf = (service: object | undefined) =>
  service === undefined ? undefined : (service as { kind?: string }).kind

async function mount(rows: readonly PluginRow[]) {
  const attached: Attach[] = []
  const modules: Record<string, unknown> = {
    "@test/bot": botService(attached),
    "@test/fs": tagged("fs"),
    "@test/subprocess": tagged("subprocess"),
    [FILES_ROW_PLUGIN]: BotEnvironmentFiles,
  }
  class TestLoader extends Loader {
    constructor(ctx: Context) {
      super(ctx)
      this.builtins.group = Group
    }
    override import(name: string) {
      return name.startsWith("cordis:")
        ? this.builtins[name.slice(7)]
        : Promise.resolve(modules[name])
    }
    commit() {}
  }
  const ctx = new Context()
  await ctx.plugin(TestLoader)
  const loader = (ctx as unknown as { loader: Loader }).loader
  await loader.root.update([
    { id: "host-bot", name: "@test/bot" },
    { id: "host-fs", name: "@test/fs", config: { kind: "host" } },
    { id: "host-subprocess", name: "@test/subprocess", config: { kind: "host" } },
    ...(rows as never[]),
  ])
  await loader.await()
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { attached, loader }
}

const template: BotTemplate = { id: "t", plugins: [] }
const environment = {
  id: "vm",
  isolate: ["fs", "subprocess"],
  rows: [
    { id: "env-fs", name: "@test/fs", config: { kind: "vm" } },
    { id: "env-subprocess", name: "@test/subprocess", config: { kind: "vm" } },
  ],
}

function composed(overlay: BotOverlay = []) {
  const result = composeBotPreset({
    botId: "b1",
    botName: "B",
    template,
    overlay,
    environment,
    allowedHostTools: new Set(),
    web: { backend: "exa", search: true, fetch: true },
    seal: (revision) => `sealed:${revision}`,
  })
  if (!result.ok) throw new Error(result.problem)
  return result
}

describe("bot-core's files row under the real Loader", () => {
  it("hands over the bot group's own fs and subprocess, with the revision's token", async () => {
    const result = composed()
    const { attached } = await mount(result.preset.plugins)
    expect(attached).toHaveLength(1)
    const [entry] = attached
    expect(entry?.botId).toBe("b1")
    expect(entry?.token).toBe(result.revisionToken)
    expect(kindOf(entry?.services.fs())).toBe("vm")
    expect(kindOf(entry?.services.subprocess())).toBe("vm")
  })

  it("hands over nothing of the Host's: at the top level, or in a group that does not isolate", async () => {
    const stray: PluginRow = {
      id: "stray",
      name: FILES_ROW_PLUGIN,
      config: { botId: "b1", token: "t" },
    }
    const { attached } = await mount([
      stray,
      {
        id: "plain-group",
        name: "cordis:group",
        group: true,
        config: [{ ...stray, id: "stray-in-group" }],
      },
      {
        id: "empty-isolation",
        name: "cordis:group",
        group: true,
        isolate: { fs: true, subprocess: true },
        config: [{ ...stray, id: "stray-isolated" }],
      },
    ])
    expect(attached).toHaveLength(3)
    for (const entry of attached) {
      expect(entry.services.fs()).toBeUndefined()
      expect(entry.services.subprocess()).toBeUndefined()
    }
  })

  it("still sees the bot's services from a nested group inside the bot's group", async () => {
    const result = composed()
    const [group] = result.preset.plugins
    const config = group?.config as PluginRow[]
    const nested: PluginRow = {
      ...(group as PluginRow),
      config: [
        ...config.filter((row) => row.id !== FILES_ROW_ID),
        {
          id: "nested",
          name: "cordis:group",
          group: true,
          config: config.filter((row) => row.id === FILES_ROW_ID),
        },
      ],
    }
    const { attached } = await mount([nested])
    expect(kindOf(attached[0]?.services.fs())).toBe("vm")
  })

  it("detaches when its revision is unmounted", async () => {
    const { attached, loader } = await mount(composed().preset.plugins)
    await loader.root.update([])
    await loader.await()
    expect(attached[0]?.detached).toBe(true)
  })
})
