import { Context } from "@deepseek-ai/cordis"
import { describe, expect, expectTypeOf, it } from "vitest"
import { type BotChannel, type BotEnvironment, botOf } from "../src/contract"
import { createChannelCatalog } from "../src/host/channels/catalog"
import { createEnvironmentKeeper } from "../src/host/environment"
import { createTemplateCatalog } from "../src/host/preset/catalog"
import {
  ATTACH_ENVIRONMENT_SERVICES,
  type BotEnvironmentServices,
  CALL_CONNECTOR_TOOL,
  type CallConnectorTool,
  STAY_CHANNEL_SILENT,
  type StayChannelSilent,
  WATCH_CONNECTOR_TOOLS,
  type WatchConnectorTools,
} from "../src/internal"
import BotTemplateDeclaration from "../src/plugins/template"
import { type BotBackend, BotService } from "../src/service"
import { DEFAULT_BOT_ENVIRONMENT_SPEC } from "../src/shared/environment"
import { DEFAULT_BOT_MODELS } from "../src/shared/models"
import { TEST_CAPACITY } from "./support/environment"

interface FakeBackend extends BotBackend {
  readonly calls: string[]
}

function fakeBackend(): FakeBackend {
  const calls: string[] = []
  return {
    calls,
    registry: { list: () => [] },
    spaces: {
      list: () => [],
      subscribe: () => () => {},
      available: () => false,
      call: async () => ({ text: "" }),
    },
    describePrompt: (botId, token, agentId) => {
      calls.push(`describe ${botId} ${token} ${agentId}`)
      throw new Error("not a bot Agent")
    },
    notes: {
      call: async (botId, token, request) => {
        calls.push(`note ${botId} ${token} ${request.tool}`)
        return { text: "ok" }
      },
      prepare: async () => undefined,
      pinned: () => "",
    },
    settings: {
      register: () => () => {},
      list: () => [],
      available: () => true,
      call: async (botId, token, request) => {
        calls.push(`settings ${botId} ${token} ${request.agentId}`)
        return { text: "ok" }
      },
    },
    skills: {
      available: () => true,
      call: async (botId, token, request) => {
        calls.push(`skill ${botId} ${token} ${request.agentId}`)
        return { text: "ok" }
      },
      prepare: async () => undefined,
      list: async () => [],
      load: async () => undefined,
      watch: () => () => {},
    },
    vaults: {
      register: () => () => {},
      list: () => [],
      guardArguments: async () => ({ kind: "allow" }),
      guardResult: async () => ({ kind: "clean" }),
      credentialsAvailable: () => false,
      listCredentials: async () => ({ text: "", data: null }),
    },
    botIds: () => ["a", "creating"],
    channels: createChannelCatalog(),
    templates: createTemplateCatalog(),
    presetOf: (id) => (id === "a" ? { id: "bot-a", ready: true, template: "default" } : undefined),
    onPresetChange: (listener) => {
      calls.push("subscribe")
      listener("a")
      return () => calls.push("unsubscribe")
    },
    previewPreset: (id) => {
      calls.push(`preview ${id}`)
      return { ok: true, template: "default", hostTools: [] }
    },
    configurePreset: async (id) => {
      calls.push(`configure ${id}`)
      return { id: `bot-${id}`, ready: true, template: "default" }
    },
    createSession: async (id, options) => {
      calls.push(`session ${id} ${options?.title ?? "-"}`)
      return { sessionId: "s1" }
    },
    conversations: {
      available: (botId, token, agentId) => {
        calls.push(`conversations available ${botId} ${token} ${agentId}`)
        return true
      },
      call: async (botId, token, request) => {
        calls.push(`conversation tool ${botId} ${token} ${request.tool}`)
        return { text: "ok" }
      },
    },
    peers: {
      available: (botId, token, agentId) => {
        calls.push(`peers available ${botId} ${token} ${agentId}`)
        return true
      },
      call: async (botId, token) => {
        calls.push(`peer tool ${botId} ${token}`)
        return { text: "ok", data: null }
      },
    },
    managedSessions: {
      available: (botId, token, agentId) => {
        calls.push(`sessions available ${botId} ${token} ${agentId}`)
        return true
      },
      call: async (botId, token, request) => {
        calls.push(`session tool ${botId} ${token} ${request.tool}`)
        return { text: "ok", data: null }
      },
    },
    models: {
      view: (botId) => {
        calls.push(`models ${botId}`)
        return { botId, models: DEFAULT_BOT_MODELS, mainPending: false }
      },
      configure: async (botId) => {
        calls.push(`configure models ${botId}`)
        return { botId, models: DEFAULT_BOT_MODELS, mainPending: true }
      },
      catalog: async () => ({
        profileDefault: { provider: "p", model: "m" },
        providers: [],
        failures: [],
      }),
      resolve: async () => ({ provider: "p", model: "m" }),
      subscribe: () => () => {},
    },
    environments: createEnvironmentKeeper({
      target: () => undefined,
      spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
      adopt: async () => {},
      botIds: () => [],
      held: () => false,
      release: async () => {},
      later: () => () => {},
      now: () => 0,
      warn: () => {},
    }),
    compactors: { attach: () => () => {} },
    mainPreparations: { register: () => () => {} },
    environmentServices: {
      attach: (botId, token) => {
        calls.push(`attach ${botId} ${token}`)
        return () => calls.push(`detach ${botId}`)
      },
    },
    connectors: {
      register: () => {
        calls.push("register connector")
        return () => {}
      },
      list: () => [],
      states: (botId) => {
        calls.push(`states ${botId}`)
        return []
      },
      configure: async (botId, connectorId) => {
        calls.push(`configure connector ${botId} ${connectorId}`)
        throw new Error("not in this test")
      },
      retry: () => {
        throw new Error("not in this test")
      },
      onStateChange: () => () => {},
      toolAvailable: (botId, token, agentId, name) => {
        calls.push(`connector available ${botId} ${token} ${agentId} ${name}`)
        return true
      },
      permissions: (botId) => {
        calls.push(`permissions ${botId}`)
        return []
      },
      setPermission: async (botId, change) => {
        calls.push(`permission ${botId} ${change.tool} ${change.permission}`)
        return []
      },
      actions: () => [],
      subscribe: () => () => {},
      watchTools: (botId, token, listener) => {
        calls.push(`watch ${botId} ${token}`)
        listener([])
        return () => {}
      },
      callTool: async (botId, token, request) => {
        calls.push(`call ${botId} ${token} ${request.name}`)
        return { text: "ok", data: null }
      },
    },
    connectionProviders: {
      register: () => {
        calls.push("register provider")
        return () => {}
      },
      list: () => [],
    },
    stayChannelSilent: (botId, token, request) => {
      calls.push(`silence ${botId} ${token} ${request.agentId}`)
      return { turn: 3 }
    },
    schedules: {
      available: (botId, token, agentId, tool) => {
        calls.push(`available ${botId} ${token} ${agentId} ${tool}`)
        return true
      },
      call: async (botId, token, request) => {
        calls.push(`schedule ${botId} ${token} ${request.tool}`)
        return { text: "ok", data: null }
      },
    },
    web: {
      register: () => {
        calls.push("web register")
        return () => {}
      },
      list: () => [],
      status: () => ({ search: { state: "disabled" }, fetch: { state: "disabled" } }),
      subscribe: () => () => {},
      ready: async (botId, token, capability) => {
        calls.push(`web ready ${botId} ${token} ${capability}`)
        return true
      },
      search: async (botId, token, request) => {
        calls.push(`web search ${botId} ${token} ${request.query}`)
        return { ok: true, result: { sources: [], truncated: false } }
      },
      fetch: async (botId, token, request) => {
        calls.push(`web fetch ${botId} ${token} ${request.url}`)
        return { ok: false, refusal: { code: "WEB_PROVIDER_UNAVAILABLE", message: "off" } }
      },
    },
  }
}

const environment: BotEnvironment = {
  id: "vm",
  isolate: [],
  workspace: "/home/bot/workspace",
  ensure: async () => {},
  remove: async () => {},
  rows: () => [],
  capacity: async () => TEST_CAPACITY,
  inspect: async () => undefined,
}

const fields = [
  {
    kind: "secret",
    agent: { note: "Test secret." },
    key: "token",
    label: { en: "Token" },
    required: true,
    maxLength: 100,
  },
] as const

function channel(id: string): BotChannel<typeof fields> {
  return {
    id,
    name: "Example",
    fields,
    audience: () => "owners",
    capabilities: { turns: false, interactions: [], commands: [] },
    connect: () => ({ receive: async () => {}, close: async () => {} }),
  }
}

describe("BotService", () => {
  it("requires a complete backend", () => {
    expectTypeOf(BotService).constructorParameters.toEqualTypeOf<[Context, BotBackend]>()
    expectTypeOf<Required<BotBackend>>().toEqualTypeOf<BotBackend>()
  })

  it("lists every stored bot id, the ones being created included, as a fresh array", () => {
    const bot = new BotService(new Context(), fakeBackend())
    expect(bot.bots()).toEqual([])
    expect(bot.botIds()).toEqual(["a", "creating"])
    expect(bot.botIds()).not.toBe(bot.botIds())
  })

  it("delegates connector methods, its row's ones under symbols", async () => {
    const backend = fakeBackend()
    const bot = new BotService(new Context(), backend)
    bot.connectorPermissions("a")
    await bot.setConnectorPermission("a", { connectorId: "mail", tool: "send", permission: "ask" })
    const watch = Reflect.get(bot, WATCH_CONNECTOR_TOOLS) as WatchConnectorTools
    const call = Reflect.get(bot, CALL_CONNECTOR_TOOL) as CallConnectorTool
    watch.call(bot, "a", "tok", () => {})
    await call.call(
      bot,
      "a",
      "tok",
      { agentId: "s1", name: "mail_send", args: {} },
      new AbortController().signal,
    )
    expect(backend.calls).toEqual([
      "permissions a",
      "permission a send ask",
      "watch a tok",
      "call a tok mail_send",
    ])
    expect(Object.keys(bot)).not.toContain("connectors")
  })

  it("passes its channel row's stay_silent calls to the backend under a symbol", () => {
    const backend = fakeBackend()
    const bot = new BotService(new Context(), backend)
    const staySilent = Reflect.get(bot, STAY_CHANNEL_SILENT) as StayChannelSilent
    expect(staySilent.call(bot, "a", "tok", { agentId: "s1" })).toEqual({ turn: 3 })
    expect(backend.calls).toEqual(["silence a tok s1"])
    expect(Object.keys(bot)).not.toContain("stayChannelSilent")
  })

  it("refuses a channel with invalid capabilities", () => {
    const bot = new BotService(new Context(), fakeBackend())
    expect(() =>
      bot.registerChannel({
        ...channel("example"),
        capabilities: { turns: true, interactions: [], commands: ["reboot" as "stop"] },
      }),
    ).toThrow("reboot")
  })

  it("registers and unregisters a channel", () => {
    const bot = new BotService(new Context(), fakeBackend())
    const dispose = bot.registerChannel(channel("example"))
    expect(bot.channels().map((entry) => entry.id)).toEqual(["example"])
    expect(() => bot.registerChannel(channel("example"))).toThrow("already registered")
    dispose()
    expect(bot.channels()).toEqual([])
  })

  it("refuses an invalid channel descriptor", () => {
    const bot = new BotService(new Context(), fakeBackend())
    expect(() => bot.registerChannel(channel("Bad Id"))).toThrow("lowercase")
  })

  it("is read back with botOf", () => {
    const ctx = new Context()
    const bot = new BotService(ctx, fakeBackend())
    botOf(ctx).registerChannel(channel("example"))
    expect(bot.channels().map((entry) => entry.id)).toEqual(["example"])
  })

  it("delegates templates, preset state, configuration and sessions", async () => {
    const backend = fakeBackend()
    const bot = new BotService(new Context(), backend)
    const dispose = bot.registerTemplate({ id: "helper", plugins: [{ id: "p", name: "@x/p" }] })
    expect(bot.templates().map((template) => template.id)).toEqual(["helper"])
    expect(() => bot.registerTemplate({ id: "helper", plugins: [] })).toThrow("already registered")
    dispose()
    expect(bot.templates()).toEqual([])
    expect(bot.presetOf("a")).toMatchObject({ ready: true })
    expect(bot.presetOf("b")).toBeUndefined()
    expect(bot.previewPreset("a", {})).toMatchObject({ ok: true })
    const changed: string[] = []
    bot.onPresetChange((botId) => changed.push(botId))()
    await bot.configurePreset("a", {})
    await expect(bot.createSession("a", { title: "t" })).resolves.toEqual({ sessionId: "s1" })
    expect(changed).toEqual(["a"])
    expect(backend.calls).toEqual([
      "preview a",
      "subscribe",
      "unsubscribe",
      "configure a",
      "session a t",
    ])
  })

  it("registers one environment at a time", () => {
    const bot = new BotService(new Context(), fakeBackend())
    expect(bot.environment()).toBeUndefined()
    const unregister = bot.registerEnvironment(environment)
    expect(bot.environment()).toEqual({ id: "vm", isolate: [], workspace: "/home/bot/workspace" })
    expect(bot.environment()).not.toHaveProperty("remove")
    expect(() => bot.registerEnvironment({ ...environment, id: "other" })).toThrow(
      "already registered",
    )
    unregister()
    expect(bot.environment()).toBeUndefined()
  })

  it("hands a files row's environment services to the backend", () => {
    const backend = fakeBackend()
    const bot = new BotService(new Context(), backend)
    const services: BotEnvironmentServices = { fs: () => undefined, subprocess: () => undefined }
    bot[ATTACH_ENVIRONMENT_SERVICES]("a", "token", services)()
    expect(backend.calls).toEqual(["attach a token", "detach a"])
  })

  it("lets a template declaration row register through the real service", async () => {
    const ctx = new Context()
    const backend = fakeBackend()
    await ctx.plugin((child: Context) => {
      new BotService(child, backend)
    })
    const fiber = ctx.plugin(BotTemplateDeclaration, {
      id: "helper",
      plugins: [{ id: "persona", name: "@deepseek-ai/dsh-persona" }],
    })
    await fiber
    expect(
      botOf(ctx)
        .templates()
        .map((template) => template.id),
    ).toEqual(["helper"])
    await fiber.dispose()
    expect(botOf(ctx).templates()).toEqual([])
  })
})
