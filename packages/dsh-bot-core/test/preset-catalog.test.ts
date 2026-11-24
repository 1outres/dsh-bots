import { Context, Service } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import { createTemplateCatalog } from "../src/host/preset/catalog"
import { composeBotPreset, composeRows, templateProblem } from "../src/host/preset/compose"
import { DEFAULT_PERSONA, defaultTemplate } from "../src/host/preset/default-template"
import BotTemplateDeclaration, { ENTRY_GROUP } from "../src/plugins/template"
import { type BotTemplate, DEFAULT_TEMPLATE_ID, type PluginRow } from "../src/shared/preset"

function template(id: string, plugins: unknown[] = [{ id: "persona", name: "p" }]): BotTemplate {
  return { id, plugins: plugins as PluginRow[] }
}

describe("createTemplateCatalog", () => {
  it("registers, reads back sorted and unregisters", () => {
    const catalog = createTemplateCatalog()
    const b = template("b")
    const disposeB = catalog.register(b)
    const disposeA = catalog.register(template("a"))
    expect(catalog.get("b")).toBe(b)
    expect(catalog.list().map((entry) => entry.id)).toEqual(["a", "b"])
    disposeB()
    expect(catalog.get("b")).toBeUndefined()
    disposeA()
    expect(catalog.list()).toEqual([])
  })

  it("rejects a duplicate id until the first registration is disposed", () => {
    const catalog = createTemplateCatalog()
    const dispose = catalog.register(template("a"))
    expect(() => catalog.register(template("a"))).toThrow('bot template "a" is already registered')
    dispose()
    expect(() => catalog.register(template("a"))).not.toThrow()
  })

  it.each([
    ["a non-map", 42, "the template is not a map"],
    ["a bad id", template("Bad_Id"), 'template id "Bad_Id" must be'],
    ["a missing id", { plugins: [] }, "template id undefined must be"],
    ["no plugin list", { id: "a" }, "plugins must be a list"],
    ["a row without id", template("a", [{ name: "p" }]), "row 1 has no id"],
    ["a row without name", template("a", [{ id: "x", name: "" }]), "names no plugin"],
    [
      "a duplicate nested id",
      template("a", [
        { id: "x", name: "p" },
        { id: "g", name: "cordis:group", group: true, config: [{ id: "x", name: "q" }] },
      ]),
      'row 2 row 1 ("x") repeats the id of row 1',
    ],
    [
      "a group without rows",
      template("a", [{ id: "g", name: "cordis:group", group: true }]),
      "group row 1",
    ],
    ["a non-list hostTools", { ...template("a"), hostTools: "bash" }, "hostTools must be a list"],
    ["a non-string tool", { ...template("a"), hostTools: ["ok", 3] }, "hostTools entry 2"],
  ])("rejects %s", (_label, candidate, message) => {
    const catalog = createTemplateCatalog()
    expect(() => catalog.register(candidate as BotTemplate)).toThrow(message)
    expect(catalog.list()).toEqual([])
  })

  it("keeps !!js nodes as they are", () => {
    const catalog = createTemplateCatalog()
    const disabled = { __jsExpr: "process.platform === 'win32'" }
    catalog.register(template("a", [{ id: "x", name: "p", disabled }]))
    expect(catalog.get("a")?.plugins[0]?.disabled).toBe(disabled)
  })

  it("makes a disposer idempotent and never removes a later registration", () => {
    const catalog = createTemplateCatalog()
    const seen: string[] = []
    catalog.subscribe((id) => seen.push(id))
    const a = template("a")
    const first = catalog.register(a)
    first()
    const second = catalog.register(a)
    first()
    expect(catalog.get("a")).toBe(a)
    second()
    second()
    expect(catalog.get("a")).toBeUndefined()
    expect(seen).toEqual(["a", "a", "a", "a"])
  })

  it("notifies subscribers on register and unregister, not on a rejected register", () => {
    const catalog = createTemplateCatalog()
    const seen: string[] = []
    const unsubscribe = catalog.subscribe((id) => seen.push(id))
    const dispose = catalog.register(template("a"))
    expect(() => catalog.register(template("a"))).toThrow()
    expect(() => catalog.register(template("B"))).toThrow()
    dispose()
    unsubscribe()
    catalog.register(template("b"))
    expect(seen).toEqual(["a", "a"])
  })

  it("keeps notifying after a subscriber throws and reports it", () => {
    const warnings: string[] = []
    const catalog = createTemplateCatalog({ warn: (message) => warnings.push(message) })
    const seen: string[] = []
    catalog.subscribe(() => {
      throw new Error("boom")
    })
    catalog.subscribe((id) => seen.push(id))
    catalog.register(template("a"))
    expect(seen).toEqual(["a"])
    expect(warnings).toEqual(['bot-core: a template listener failed for "a": Error: boom'])
  })

  it("keeps a subscription per subscribe call", () => {
    const catalog = createTemplateCatalog()
    let calls = 0
    const listener = () => {
      calls += 1
    }
    const unsubscribe = catalog.subscribe(listener)
    catalog.subscribe(listener)
    unsubscribe()
    catalog.register(template("a"))
    expect(calls).toBe(1)
  })
})

describe("defaultTemplate", () => {
  it("is a valid template with the default id and no host tools", () => {
    const linux = defaultTemplate()
    expect(linux.id).toBe(DEFAULT_TEMPLATE_ID)
    expect(templateProblem(linux)).toBeUndefined()
    expect(linux.hostTools).toEqual([])
    expect(() => createTemplateCatalog().register(linux)).not.toThrow()
  })

  it("keeps the standard preset's row ids", () => {
    expect(defaultTemplate().plugins.map((row) => row.id)).toEqual([
      "persona",
      "agent-instructions",
      "time-context",
      "tool-bash",
      "tool-fs",
      "tool-fs-search",
      "tool-jobs",
      "tool-ask-user",
      "tool-skill",
      "compaction",
      "tool-web",
    ])
  })

  it("runs bash only, enabled on every Host platform (the bot's environment is Linux)", () => {
    const shells = defaultTemplate().plugins.filter((row) => /tool-(bash|pwsh)/.test(row.id))
    expect(shells).toEqual([{ id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash" }])
  })

  it("carries the bot persona and composes", () => {
    const template = defaultTemplate()
    expect(template.plugins[0]?.config).toEqual({ prefix: DEFAULT_PERSONA })
    const input = {
      botId: "b1",
      botName: "Mia",
      template,
      overlay: [],
      allowedHostTools: new Set<string>(),
      web: { backend: "exa", search: true, fetch: true },
    }
    expect(composeRows(input).ok).toBe(true)
    const environment = { id: "vm", isolate: ["fs"], rows: [{ id: "env-fs", name: "@x/fs" }] }
    const wrapped = composeBotPreset({ ...input, environment, seal: (revision) => revision })
    expect(wrapped.ok).toBe(true)
  })

  it("returns a fresh template each call", () => {
    expect(defaultTemplate()).not.toBe(defaultTemplate())
    expect(defaultTemplate()).toEqual(defaultTemplate())
  })
})

class FakeBot extends Service {
  registered: BotTemplate[] = []
  disposed: string[] = []

  constructor(ctx: Context) {
    super(ctx, "bot")
  }

  registerTemplate(template: BotTemplate): () => void {
    const problem = templateProblem(template)
    if (problem !== undefined) throw new Error(problem)
    this.registered.push(template)
    return () => {
      this.disposed.push(template.id)
    }
  }
}

describe("@1outres/dsh-bot-core/template", () => {
  const config = {
    id: "helper",
    name: "Helper",
    plugins: [
      {
        id: "tool-bash",
        name: "@deepseek-ai/dsh-tool-bash",
        disabled: { __jsExpr: "process.platform === 'win32'" },
      },
    ],
    hostTools: ["working_directory"],
  }

  it("marks itself as a Loader entry group so child !!js nodes stay unevaluated", () => {
    expect(ENTRY_GROUP).toBe(Symbol.for("cordis.group"))
    expect((BotTemplateDeclaration as unknown as Record<symbol, unknown>)[ENTRY_GROUP]).toBe(true)
    expect(BotTemplateDeclaration.inject).toEqual(["bot"])
  })

  it("registers its config while active and unregisters on dispose", async () => {
    const ctx = new Context()
    await ctx.plugin(FakeBot)
    const fiber = ctx.plugin(BotTemplateDeclaration, config)
    await fiber
    const live = ctx.get("bot") as FakeBot
    expect(live.registered.map((template) => template.id)).toEqual(["helper"])
    expect(live.registered[0]?.plugins).toEqual(config.plugins)
    expect(live.registered[0]?.hostTools).toEqual(["working_directory"])
    await fiber.dispose()
    expect(live.disposed).toEqual(["helper"])
  })

  it("fails the row when the bot service rejects the template", async () => {
    const ctx = new Context()
    await ctx.plugin(FakeBot)
    const fiber = ctx.plugin(BotTemplateDeclaration, { ...config, id: "Not Valid" })
    await expect(fiber).rejects.toThrow('template id "Not Valid"')
  })

  it("rejects a config without plugins through its schema", async () => {
    const ctx = new Context()
    await ctx.plugin(FakeBot)
    const fiber = ctx.plugin(BotTemplateDeclaration, { id: "helper" } as BotTemplate)
    await expect(fiber).rejects.toThrow()
    expect((ctx.get("bot") as FakeBot).registered).toEqual([])
  })
})
