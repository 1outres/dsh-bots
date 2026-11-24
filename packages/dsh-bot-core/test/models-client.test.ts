import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  createModelsHub,
  createModelsModel,
  ModelsError,
  refusalOf,
} from "../src/client/models/feed"
import {
  effortChoices,
  modelChoices,
  modelsFailureText,
  optionLabel,
} from "../src/client/models/labels"
import { appended, moved, removed, replaced } from "../src/client/models/list"
import { ModelRoute } from "../src/client/models/ModelRoute"
import {
  choiceOf,
  DEFAULT_EFFORT,
  effortOf,
  holds,
  modelMenu,
  unlisted,
} from "../src/client/models/menu"
import type { RemoteMount } from "../src/client/remote"
import { ModelsSection } from "../src/client/settings/ModelsSection"
import type { BotModelCatalog, BotModelChoice, BotModelsView } from "../src/shared/models"
import { DEFAULT_BOT_MODELS, PROFILE_DEFAULT_MODEL } from "../src/shared/models"
import { bot, t, value } from "./support/client"

const CATALOG: BotModelCatalog = {
  profileDefault: { provider: "ds", model: "v4" },
  providers: [
    {
      id: "ds",
      name: "DeepSeek",
      models: [
        {
          id: "v4",
          name: "DeepSeek V4",
          reasoning: {
            efforts: [
              { id: "low", name: "Low" },
              { id: "high", name: "High" },
            ],
            defaultEffort: "high",
          },
        },
        { id: "lite", name: "Lite" },
      ],
    },
  ],
  failures: [{ id: "or", name: "OpenRouter", message: "offline" }],
}

const fixed = (model: string, reasoningEffort?: string): BotModelChoice => ({
  kind: "fixed",
  provider: "ds",
  model,
  ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
})

const gone: BotModelChoice = { kind: "fixed", provider: "old", model: "m" }

describe("model menu", () => {
  it("lists DSH's default, the catalog's models by provider, then stored routes it does not list", () => {
    const menu = modelMenu(CATALOG, [fixed("v4", "low"), gone, PROFILE_DEFAULT_MODEL])
    expect(menu.listed).toBe(true)
    expect(
      menu.options.map((option) => (option.kind === "fixed" ? option.model.id : option.kind)),
    ).toEqual(["profile-default", "v4", "lite", "m"])
    expect(new Set(menu.options.map((option) => option.key)).size).toBe(4)
    expect(menu.optionOf(fixed("v4", "low"))).toBe(menu.options[1])
    expect(unlisted(menu, menu.optionOf(gone))).toBe(true)
    expect(unlisted(menu, menu.optionOf(fixed("lite")))).toBe(false)
    expect(optionLabel(t, menu, menu.optionOf(PROFILE_DEFAULT_MODEL))).toBe(
      "models.profileDefaultNamed(DeepSeek V4)",
    )
    expect(modelChoices(t, menu).map((choice) => choice.group)).toEqual([
      undefined,
      "DeepSeek",
      "DeepSeek",
      "old",
    ])
  })

  it("knows stored routes only by their ids until the catalog is read", () => {
    const menu = modelMenu(undefined, [fixed("v4")])
    expect(menu.listed).toBe(false)
    expect(menu.options).toHaveLength(2)
    expect(unlisted(menu, menu.optionOf(fixed("v4")))).toBe(false)
    expect(optionLabel(t, menu, menu.options[0] ?? menu.optionOf(PROFILE_DEFAULT_MODEL))).toBe(
      "models.profileDefault",
    )
    expect(() => menu.optionOf(fixed("lite"))).toThrow(/outside its menu/)
  })

  it("offers a model's efforts after its provider's default, and keeps a stored one it dropped", () => {
    const menu = modelMenu(CATALOG, [fixed("v4", "max")])
    const v4 = menu.optionOf(fixed("v4"))
    expect(effortChoices(t, v4, undefined).map((choice) => [choice.value, choice.label])).toEqual([
      [DEFAULT_EFFORT, "models.effort.defaultNamed(High)"],
      ["low", "Low"],
      ["high", "High"],
    ])
    expect(effortChoices(t, v4, "max").at(-1)).toEqual({ value: "max", label: "max" })
    expect(effortChoices(t, menu.optionOf(fixed("lite")), undefined)).toEqual([])
    expect(effortChoices(t, menu.optionOf(PROFILE_DEFAULT_MODEL), undefined)).toEqual([])
    expect(effortChoices(t, v4, undefined, (effort) => effort === "low")[1]?.disabled).toBe(true)
  })

  it("turns picks into choices: a new model at its provider's effort", () => {
    const menu = modelMenu(CATALOG, [])
    const v4 = menu.optionOf(fixed("v4"))
    expect(choiceOf(v4)).toEqual(fixed("v4"))
    expect(choiceOf(v4, "low")).toEqual(fixed("v4", "low"))
    expect(choiceOf(menu.optionOf(PROFILE_DEFAULT_MODEL), "low")).toBe(PROFILE_DEFAULT_MODEL)
    expect(effortOf(fixed("v4", "low"))).toBe("low")
    expect(effortOf(PROFILE_DEFAULT_MODEL)).toBe(DEFAULT_EFFORT)
    expect(holds([fixed("v4"), fixed("lite")], fixed("lite"))).toBe(true)
    expect(holds([fixed("v4"), fixed("lite")], fixed("lite"), 1)).toBe(false)
  })
})

describe("delegate list", () => {
  const list = [fixed("v4"), fixed("lite"), PROFILE_DEFAULT_MODEL]
  it("adds, removes, replaces and moves an item", () => {
    expect(appended(list, gone)).toEqual([...list, gone])
    expect(removed(list, 1)).toEqual([fixed("v4"), PROFILE_DEFAULT_MODEL])
    expect(replaced(list, 0, fixed("v4", "low"))[0]).toEqual(fixed("v4", "low"))
    expect(moved(list, 1, -1)).toEqual([fixed("lite"), fixed("v4"), PROFILE_DEFAULT_MODEL])
    expect(moved(list, 2, 1)).toBeUndefined()
    expect(moved(list, 0, -1)).toBeUndefined()
  })
})

describe("model refusals", () => {
  it("keeps a bot-models code with where it is, and words it for the user", () => {
    const failure = refusalOf({
      code: "bot-models/unknown-model",
      message: "p/m is not advertised",
      details: { role: "delegates", index: 2 },
    })
    expect(failure).toEqual({
      kind: "refused",
      code: "bot-models/unknown-model",
      place: { role: "delegates", index: 2 },
      message: "p/m is not advertised",
    })
    expect(modelsFailureText(t, failure)).toBe("models.refused.unknown-model")
    expect(refusalOf({ code: "bot-models/rejected", details: { role: "nope" } })).toMatchObject({
      place: {},
    })
    const bad = refusalOf({ code: "gateway/bad-request", message: "main must be an object" })
    expect(bad).toEqual({
      kind: "invalid",
      code: "gateway/bad-request",
      message: "main must be an object",
    })
    expect(modelsFailureText(t, bad)).toBe("error.generic(main must be an object)")
  })
})

const VIEW: BotModelsView = {
  botId: "x",
  models: {
    main: fixed("v4", "low"),
    utility: PROFILE_DEFAULT_MODEL,
    delegates: [fixed("lite"), gone],
  },
  mainPending: true,
}

function mounted(bots: Record<string, unknown>): Promise<RemoteMount> {
  return Promise.resolve({ status: "mounted", remote: { bots } } as unknown as RemoteMount)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("models model", () => {
  it("follows the bot's models and rejects a refused change with its code", async () => {
    const opened: string[] = []
    const model = createModelsModel(
      {
        mount: mounted({
          watchModels: (botId: string) => {
            opened.push(botId)
            return {
              dispose() {},
              async *[Symbol.asyncIterator]() {
                yield VIEW
                await new Promise(() => {})
              },
            }
          },
          configureModels: async () => ({
            ok: false,
            error: { code: "bot-models/invalid-effort", message: "no", details: { role: "main" } },
          }),
        }),
        generation: value<object | undefined>({}),
      },
      "x",
    )
    await settle()
    expect(opened).toEqual(["x"])
    expect(model.getSnapshot()).toEqual({ status: "ready", view: VIEW })
    const refused = model.configure({ main: fixed("v4", "max") })
    await expect(refused).rejects.toBeInstanceOf(ModelsError)
    await expect(refused).rejects.toMatchObject({
      failure: { kind: "refused", code: "bot-models/invalid-effort", place: { role: "main" } },
    })
    model.dispose()
  })
})

describe("models section", () => {
  const hub = (state: unknown) =>
    createModelsHub(() => ({
      ...value(state as never),
      configure: async () => VIEW,
      dispose() {},
    }))
  const never = () => new Promise<BotModelCatalog>(() => {})

  it("shows the roles and the delegates with pickers locked until the catalog is read", () => {
    const models = hub({ status: "ready", view: VIEW })
    const off = models.feed("x").subscribe(() => {})
    const html = renderToStaticMarkup(
      createElement(ModelsSection, {
        t,
        bot: bot("x", "m1"),
        models,
        readCatalog: never,
        page: { detail: null, open() {}, back() {} },
        close() {},
        confirm: async () => false,
      } as never),
    )
    off()
    expect(html).toContain('data-dshb-model-role="main"')
    expect(html).toContain('data-dshb-model-role="utility"')
    expect(html).toContain("data-dshb-model-pending")
    expect(html).toContain("models.mainPending")
    expect(html).toMatch(/data-dshb-model-delegate="0"/)
    expect(html).toMatch(/data-dshb-model-delegate="1"/)
    expect(html).toContain("data-dshb-model-delegate-add")
    expect(html).toMatch(/aria-label="models.role.main"[^>]*disabled=""/)
    expect(html).not.toContain("dshb-hint")
  })

  it("does not mark Pending once the Main runs the stored model", () => {
    const models = hub({
      status: "ready",
      view: { ...VIEW, mainPending: false, models: DEFAULT_BOT_MODELS },
    })
    const off = models.feed("x").subscribe(() => {})
    const html = renderToStaticMarkup(
      createElement(ModelsSection, { t, bot: bot("x", "m1"), models, readCatalog: never } as never),
    )
    off()
    expect(html).not.toContain("data-dshb-model-pending")
    expect(html).toContain("models.profileDefault")
  })

  it("draws a model picker and, for a model with efforts, its effort", () => {
    const menu = modelMenu(CATALOG, [gone])
    const draw = (choice: BotModelChoice) =>
      renderToStaticMarkup(
        createElement(ModelRoute, { t, menu, value: choice, label: "Main", onChange() {} }),
      )
    const v4 = draw(fixed("v4", "low"))
    expect(v4).toContain("DeepSeek V4")
    expect(v4).toContain("data-dshb-model-effort")
    expect(v4).toMatch(/<option value="low" selected="">Low<\/option>/)
    expect(draw(fixed("lite"))).not.toContain("data-dshb-model-effort")
    expect(draw(PROFILE_DEFAULT_MODEL)).toContain("models.profileDefaultNamed(DeepSeek V4)")
  })
})
