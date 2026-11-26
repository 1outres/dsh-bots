import { createHash, createHmac } from "node:crypto"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  applyOverlay,
  BOT_PRESET_ORDER,
  composeBotPreset,
  composeRows,
  presetDigest,
  rowListProblem,
  templateProblem,
} from "../src/host/preset/compose"
import { defaultTemplate } from "../src/host/preset/default-template"
import type {
  BotPresetInput,
  BotPresetResult,
  CompositionInput,
  EnvironmentLayer,
  RowsComposition,
  RowsResult,
} from "../src/host/preset/types"
import type { BotOverlay, BotTemplate, PluginRow } from "../src/shared/preset"

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const field of Object.values(value)) frozen(field)
  }
  return value
}

const jsExpr = { __jsExpr: "process.platform === 'win32'" }

function template(overrides: Partial<BotTemplate> = {}): BotTemplate {
  return frozen({
    id: "base",
    name: "Base",
    plugins: [
      { id: "persona", name: "@deepseek-ai/dsh-persona", config: { prefix: "Hi" } },
      { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: jsExpr },
      {
        id: "planning",
        name: "cordis:group",
        group: true,
        isolate: { planMode: true },
        config: [{ id: "plan-mode", name: "@deepseek-ai/dsh-plan-mode" }],
      },
    ],
    hostTools: ["web_search", "ask_user_question", "web_search"],
    ...overrides,
  })
}

const ALLOWED_HOST_TOOLS = new Set(["web_search", "ask_user_question"])

const EMPTY_LAYER: EnvironmentLayer = frozen({ id: "vm", isolate: [], rows: [] })

const seal = (revision: string) => `sealed:${revision}`

function templateRows(overlay: BotOverlay = [], overrides: Partial<CompositionInput> = {}) {
  return composeRows(
    frozen({
      botId: "b1",
      botName: "Alice",
      template: template(),
      overlay,
      allowedHostTools: ALLOWED_HOST_TOOLS,
      web: { backend: "exa", search: true, fetch: true },
      ...overrides,
    }),
  )
}

function botPreset(overlay: BotOverlay = [], overrides: Partial<BotPresetInput> = {}) {
  return composeBotPreset(
    frozen({
      botId: "b1",
      botName: "Alice",
      template: template(),
      overlay,
      allowedHostTools: ALLOWED_HOST_TOOLS,
      web: { backend: "exa", search: true, fetch: true },
      environment: EMPTY_LAYER,
      seal,
      ...overrides,
    }),
  )
}

function ids(rows: readonly PluginRow[]): string[] {
  return rows.map((row) => row.id)
}

function ok<T extends RowsResult | BotPresetResult>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got: ${result.problem}`)
  return result as Extract<T, { ok: true }>
}

function problem(result: RowsResult | BotPresetResult): string {
  if (result.ok) throw new Error("expected a problem")
  return result.problem
}

const row = (id: string, extra: Partial<PluginRow> = {}): PluginRow => ({
  id,
  name: `@x/${id}`,
  ...extra,
})

describe("composeRows output", () => {
  it("identifies, names and orders the bot preset", () => {
    const { head: preset } = ok(templateRows())
    expect(preset.id).toBe("bot-b1")
    expect(preset.name).toBe("Bot: Alice")
    expect(preset.description).toContain('"Base"')
    expect(preset.description).toContain("base")
    expect(preset.order).toBe(BOT_PRESET_ORDER)
    expect(preset.order).toBeGreaterThan(4)
  })

  it("falls back to the template id when the template has no name", () => {
    const base = template()
    const { head } = ok(templateRows([], { template: { id: base.id, plugins: base.plugins } }))
    expect(head.description).toContain('"base"')
  })

  it("keeps the template rows as is without an overlay, in a new array", () => {
    const base = template()
    const composed = ok(templateRows([], { template: base }))
    expect(composed.rows).toEqual(base.plugins)
    expect(composed.rows).not.toBe(base.plugins)
    expect(composed.rows[0]).toBe(base.plugins[0])
  })

  it("passes !!js nodes through untouched", () => {
    expect(ok(templateRows()).rows[1]?.disabled).toBe(jsExpr)
  })

  it("passes class instances and functions in config through by reference", () => {
    class Marker {
      constructor(readonly value: number) {}
    }
    const marker = new Marker(1)
    const fn = () => 1
    const composed = ok(
      templateRows([{ op: "add", row: row("extra", { config: { marker, fn } }) }]),
    )
    const config = composed.rows.at(-1)?.config as { marker: Marker; fn: () => number }
    expect(config.marker).toBe(marker)
    expect(config.marker).toBeInstanceOf(Marker)
    expect(config.fn).toBe(fn)
  })

  it("dedupes and sorts hostTools", () => {
    expect(ok(templateRows()).hostTools).toEqual(["ask_user_question", "web_search"])
  })

  it("gives no hostTools when the template lists none", () => {
    const base = template()
    expect(
      ok(templateRows([], { template: { id: "t", plugins: base.plugins } })).hostTools,
    ).toEqual([])
  })

  it("accepts an empty template", () => {
    expect(ok(templateRows([], { template: { id: "empty", plugins: [] } })).rows).toEqual([])
  })

  it("never mutates its (frozen) inputs", () => {
    expect(() =>
      templateRows([
        { op: "add", row: row("a"), after: "persona" },
        { op: "replace", id: "tool-bash", row: row("tool-bash") },
        { op: "remove", id: "planning" },
      ]),
    ).not.toThrow()
  })
})

describe("overlay ops", () => {
  it("adds at the end", () => {
    expect(ids(ok(templateRows([{ op: "add", row: row("a") }])).rows)).toEqual([
      "persona",
      "tool-bash",
      "planning",
      "a",
    ])
  })

  it("adds right after a row, including after the last one", () => {
    expect(ids(ok(templateRows([{ op: "add", row: row("a"), after: "persona" }])).rows)).toEqual([
      "persona",
      "a",
      "tool-bash",
      "planning",
    ])
    expect(ids(ok(templateRows([{ op: "add", row: row("a"), after: "planning" }])).rows)).toEqual([
      "persona",
      "tool-bash",
      "planning",
      "a",
    ])
  })

  it("replaces a row in place", () => {
    const replacement = row("tool-bash", { config: { timeout: 5 } })
    const { rows } = ok(templateRows([{ op: "replace", id: "tool-bash", row: replacement }]))
    expect(ids(rows)).toEqual(["persona", "tool-bash", "planning"])
    expect(rows[1]).toBe(replacement)
  })

  it("replaces a group row together with its nested rows", () => {
    const group = row("planning", {
      name: "cordis:group",
      group: true,
      config: [row("other-plan")],
    })
    const { rows } = ok(templateRows([{ op: "replace", id: "planning", row: group }]))
    expect(rows[2]).toBe(group)
  })

  it("removes a row (a group with its nested rows)", () => {
    expect(ids(ok(templateRows([{ op: "remove", id: "planning" }])).rows)).toEqual([
      "persona",
      "tool-bash",
    ])
  })

  it("applies ops in order, each seeing the previous result", () => {
    const { rows } = ok(
      templateRows([
        { op: "add", row: row("a") },
        { op: "add", row: row("b"), after: "a" },
        { op: "remove", id: "a" },
        { op: "add", row: row("a"), after: "b" },
        { op: "replace", id: "b", row: row("b", { config: 1 }) },
      ]),
    )
    expect(ids(rows)).toEqual(["persona", "tool-bash", "planning", "b", "a"])
    expect(rows[3]?.config).toBe(1)
  })

  it("can remove then re-add the same id", () => {
    const { rows } = ok(
      templateRows([
        { op: "remove", id: "persona" },
        { op: "add", row: row("persona") },
      ]),
    )
    expect(ids(rows)).toEqual(["tool-bash", "planning", "persona"])
  })

  it("can remove every row", () => {
    const { rows } = ok(
      templateRows([
        { op: "remove", id: "persona" },
        { op: "remove", id: "tool-bash" },
        { op: "remove", id: "planning" },
      ]),
    )
    expect(rows).toEqual([])
  })

  it("applyOverlay returns a new array even for an empty overlay", () => {
    const rows = [row("a")]
    const result = applyOverlay(rows, [])
    expect(result).toEqual({ ok: true, rows })
    if (result.ok) expect(result.rows).not.toBe(rows)
  })
})

describe("overlay problems", () => {
  const cases: [string, BotOverlay, RegExp][] = [
    [
      "add of a used id",
      [{ op: "add", row: row("persona") }],
      /op 1 \(add "persona"\).*already in use/,
    ],
    [
      "add after a missing row",
      [{ op: "add", row: row("a"), after: "nope" }],
      /op 1 \(add "a"\).*after "nope" is not a top-level row/,
    ],
    [
      "add after a nested row",
      [{ op: "add", row: row("a"), after: "plan-mode" }],
      /after "plan-mode" is nested in a group/,
    ],
    [
      "replace of a missing row",
      [{ op: "replace", id: "nope", row: row("nope") }],
      /op 1 \(replace "nope"\).*row "nope" is not a top-level row/,
    ],
    [
      "replace of a nested row",
      [{ op: "replace", id: "plan-mode", row: row("plan-mode") }],
      /row "plan-mode" is nested in a group/,
    ],
    [
      "replace with a different row id",
      [{ op: "replace", id: "persona", row: row("other") }],
      /op 1 \(replace "persona"\).*row id "other" differs from the replaced id "persona"/,
    ],
    [
      "remove of a missing row",
      [{ op: "remove", id: "nope" }],
      /op 1 \(remove "nope"\).*row "nope" is not a top-level row/,
    ],
    [
      "remove of a nested row",
      [{ op: "remove", id: "plan-mode" }],
      /row "plan-mode" is nested in a group/,
    ],
    [
      "remove of an already removed row",
      [
        { op: "remove", id: "persona" },
        { op: "remove", id: "persona" },
      ],
      /^template "base": overlay op 2 \(remove "persona"\): row "persona" is not a top-level row$/,
    ],
  ]
  for (const [name, overlay, pattern] of cases) {
    it(name, () => {
      expect(problem(templateRows(overlay))).toMatch(pattern)
    })
  }

  it("names the failing op by its 1-based position", () => {
    expect(
      problem(
        templateRows([
          { op: "add", row: row("a") },
          { op: "remove", id: "a" },
          { op: "remove", id: "a" },
        ]),
      ),
    ).toMatch(/overlay op 3 \(remove "a"\)/)
  })

  const malformed: [string, unknown, RegExp][] = [
    ["a non-list overlay", { op: "remove", id: "persona" }, /the overlay must be a list of ops/],
    ["a non-map op", [null], /overlay op 1: is not an overlay op map/],
    [
      "an unknown op",
      [{ op: "move", id: "persona" }],
      /overlay op 1 \(move "persona"\): has unknown op "move"/,
    ],
    ["an op without op", [{ id: "persona" }], /overlay op 1: has unknown op undefined/],
    ["add without a row", [{ op: "add" }], /overlay op 1 \(add\): "row" must be a plugin row map/],
    ["add of a row without id", [{ op: "add", row: { name: "@x/a" } }], /its row has no id/],
    ["add with an empty id", [{ op: "add", row: { id: "", name: "@x/a" } }], /its row has no id/],
    [
      "add with a non-string after",
      [{ op: "add", row: row("a"), after: 3 }],
      /"after" must be a row id/,
    ],
    ["replace without id", [{ op: "replace", row: row("a") }], /"id" must be a row id/],
    ["replace without row", [{ op: "replace", id: "persona" }], /"row" must be a plugin row map/],
    ["remove without id", [{ op: "remove" }], /overlay op 1 \(remove\): "id" must be a row id/],
  ]
  for (const [name, overlay, pattern] of malformed) {
    it(`reports ${name}`, () => {
      expect(problem(templateRows(overlay as BotOverlay))).toMatch(pattern)
    })
  }
})

describe("composed preset validation", () => {
  it("rejects an added row without a name", () => {
    expect(problem(templateRows([{ op: "add", row: { id: "a", name: "" } }]))).toBe(
      'template "base" with the overlay: row 4 ("a") names no plugin (a "name" string is required)',
    )
  })

  it("rejects an added row whose name is not a string", () => {
    expect(
      problem(templateRows([{ op: "add", row: { id: "a", name: 3 } as unknown as PluginRow }])),
    ).toMatch(/row 4 \("a"\) names no plugin/)
  })

  it("rejects an added top-level id that a nested row already uses", () => {
    expect(problem(templateRows([{ op: "add", row: row("plan-mode") }]))).toMatch(
      /row 4 \("plan-mode"\) repeats the id of row 3 row 1/,
    )
  })

  it("rejects an added group whose nested ids collide", () => {
    const group = row("g", { name: "cordis:group", group: true, config: [row("persona")] })
    expect(problem(templateRows([{ op: "add", row: group }]))).toMatch(
      /row 4 row 1 \("persona"\) repeats the id of row 1/,
    )
  })

  it("rejects an added group without a list of rows", () => {
    const group = row("g", { name: "cordis:group", group: true, config: { a: 1 } })
    expect(problem(templateRows([{ op: "add", row: group }]))).toMatch(
      /group row 4 must hold a list of plugin rows/,
    )
  })

  it("rejects nested rows without id or name", () => {
    const noId = row("g", { name: "cordis:group", group: true, config: [{ name: "@x/a" }] })
    expect(problem(templateRows([{ op: "add", row: noId }]))).toMatch(/row 4 row 1 has no id/)
    const noName = row("g", { name: "cordis:group", group: true, config: [{ id: "n" }] })
    expect(problem(templateRows([{ op: "add", row: noName }]))).toMatch(
      /row 4 row 1 \("n"\) names no plugin/,
    )
  })

  it("does not treat config of a non-group row as rows", () => {
    const notGroup = row("a", { config: [{ id: "persona" }] })
    expect(ok(templateRows([{ op: "add", row: notGroup }])).rows).toHaveLength(4)
  })

  it("validates groups nested in groups", () => {
    const deep = row("g", {
      name: "cordis:group",
      group: true,
      config: [row("h", { name: "cordis:group", group: true, config: [row("tool-bash")] })],
    })
    expect(problem(templateRows([{ op: "add", row: deep }]))).toMatch(
      /row 4 row 1 row 1 \("tool-bash"\) repeats the id of row 2/,
    )
  })
})

describe("template validation", () => {
  const base = template()
  const bad: [string, unknown, RegExp][] = [
    ["not a map", null, /the template is not a map/],
    ["a bad id", { id: "Base", plugins: [] }, /template id "Base" must be lowercase/],
    ["a missing id", { plugins: [] }, /template id undefined must be lowercase/],
    ["a trailing hyphen", { id: "base-", plugins: [] }, /must be lowercase/],
    ["a non-string name", { id: "t", name: 1, plugins: [] }, /name must be a string/],
    ["a non-string description", { id: "t", description: 1, plugins: [] }, /description must be/],
    ["no plugin list", { id: "t" }, /template "t": plugins must be a list of plugin rows/],
    ["a non-map row", { id: "t", plugins: ["x"] }, /row 1 is not a plugin row/],
    ["a row without id", { id: "t", plugins: [{ name: "@x/a" }] }, /row 1 has no id/],
    [
      "duplicate ids",
      { id: "t", plugins: [row("a"), row("a")] },
      /template "t": row 2 \("a"\) repeats the id of row 1/,
    ],
    ["non-list hostTools", { id: "t", plugins: [], hostTools: "x" }, /hostTools must be a list/],
    ["an empty host tool", { id: "t", plugins: [], hostTools: ["a", ""] }, /hostTools entry 2/],
  ]
  for (const [name, value, pattern] of bad) {
    it(`rejects ${name}`, () => {
      expect(templateProblem(value)).toMatch(pattern)
      expect(problem(templateRows([], { template: value as BotTemplate }))).toMatch(pattern)
    })
  }

  it("accepts a valid template", () => {
    expect(templateProblem(base)).toBeUndefined()
    expect(templateProblem({ id: "a1-b2", plugins: [] })).toBeUndefined()
  })

  it("reports the template problem before any overlay problem", () => {
    expect(
      problem(
        templateRows([{ op: "remove", id: "nope" }], {
          template: { id: "t", plugins: [row("a"), row("a")] },
        }),
      ),
    ).toMatch(/repeats the id/)
  })

  it("rejects an empty bot id", () => {
    expect(problem(templateRows([], { botId: "" }))).toMatch(/bot id/)
  })
})

describe("rowListProblem", () => {
  it("matches entryListProblem wording for the top-level shape", () => {
    expect(rowListProblem({})).toMatch(/must be a list of plugin rows/)
    expect(rowListProblem([[]])).toBe('row 1 is not a plugin row (expected a map with a "name")')
  })

  it("accepts an empty list", () => {
    expect(rowListProblem([])).toBeUndefined()
  })
})

describe("digest", () => {
  it("is a sha256 hex string and stable across calls", () => {
    const a = ok(botPreset()).digest
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(ok(botPreset()).digest).toBe(a)
  })

  it("ignores key order, including in nested config", () => {
    const one = template({
      plugins: [{ id: "a", name: "@x/a", config: { x: 1, y: { p: 1, q: [1, { r: 2, s: 3 }] } } }],
    })
    const two = template({
      plugins: [{ config: { y: { q: [1, { s: 3, r: 2 }], p: 1 }, x: 1 }, name: "@x/a", id: "a" }],
    })
    expect(ok(botPreset([], { template: one })).digest).toBe(
      ok(botPreset([], { template: two })).digest,
    )
  })

  it("ignores hostTools order and duplicates", () => {
    const allowedHostTools = new Set(["a", "b"])
    const a = ok(botPreset([], { template: template({ hostTools: ["b", "a"] }), allowedHostTools }))
    const b = ok(
      botPreset([], { template: template({ hostTools: ["a", "b", "a"] }), allowedHostTools }),
    )
    expect(a.digest).toBe(b.digest)
  })

  it("treats undefined fields as absent", () => {
    const a = ok(botPreset([{ op: "add", row: row("a") }])).digest
    const b = ok(botPreset([{ op: "add", row: row("a", { config: undefined }) }])).digest
    expect(a).toBe(b)
  })

  it("changes with rows, row order, config values, hostTools and bot id", () => {
    const base = ok(botPreset()).digest
    const variants = [
      ok(botPreset([{ op: "add", row: row("a") }])).digest,
      ok(
        botPreset([
          { op: "remove", id: "persona" },
          { op: "add", row: template().plugins[0] as PluginRow },
        ]),
      ).digest,
      ok(
        botPreset([
          {
            op: "replace",
            id: "persona",
            row: { ...template().plugins[0], config: { prefix: "Yo" } } as PluginRow,
          },
        ]),
      ).digest,
      ok(botPreset([], { template: template({ hostTools: ["web_search"] }) })).digest,
      ok(botPreset([], { botId: "b2" })).digest,
    ]
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1)
  })

  it("ignores display fields: a rename does not re-mount the preset", () => {
    const renamed = ok(botPreset([], { botName: "Bob" }))
    expect(renamed.digest).toBe(ok(botPreset()).digest)
    expect(renamed.preset.name).toBe("Bot: Bob")
  })

  it("distinguishes !!js expressions by source", () => {
    const withExpr = (src: string) =>
      ok(botPreset([{ op: "add", row: row("a", { disabled: { __jsExpr: src } }) }])).digest
    expect(withExpr("true")).toBe(withExpr("true"))
    expect(withExpr("true")).not.toBe(withExpr("false"))
    expect(withExpr("true")).not.toBe(
      ok(botPreset([{ op: "add", row: row("a", { disabled: "true" }) }])).digest,
    )
  })

  it("keeps data keys apart from the digest's own tags", () => {
    const withConfig = (config: unknown) =>
      ok(botPreset([{ op: "add", row: row("a", { config }) }])).digest
    expect(withConfig({ $bigint: "1" })).not.toBe(withConfig(1n))
    expect(withConfig({ $number: "NaN" })).not.toBe(withConfig(Number.NaN))
    expect(withConfig({ $undefined: true })).not.toBe(withConfig([undefined]))
    expect(withConfig([null])).not.toBe(withConfig([undefined]))
    expect(withConfig("1")).not.toBe(withConfig(1))
    expect(withConfig(Number.POSITIVE_INFINITY)).not.toBe(withConfig(Number.NEGATIVE_INFINITY))
  })

  it("digests functions, class instances and symbols by identity without throwing", () => {
    class Marker {
      constructor(readonly value: number) {}
    }
    const fn = () => 1
    const marker = new Marker(1)
    const sym = Symbol("s")
    const withConfig = (config: unknown) =>
      ok(botPreset([{ op: "add", row: row("a", { config }) }])).digest
    expect(withConfig({ fn, marker, sym })).toBe(withConfig({ fn, marker, sym }))
    expect(withConfig({ fn })).not.toBe(withConfig({ fn: () => 1 }))
    expect(withConfig({ marker })).not.toBe(withConfig({ marker: new Marker(1) }))
    expect(withConfig({ marker })).not.toBe(withConfig({ marker: { value: 1 } }))
    expect(withConfig({ sym })).not.toBe(withConfig({ sym: Symbol("s") }))
    expect(withConfig({ sym: Symbol.for("k") })).toBe(withConfig({ sym: Symbol.for("k") }))
    expect(withConfig(new Map([["a", 1]]))).not.toBe(withConfig(new Map([["a", 1]])))
  })

  it("accepts null-prototype maps as plain data", () => {
    const bare = Object.assign(Object.create(null), { x: 1 })
    const withConfig = (config: unknown) =>
      ok(botPreset([{ op: "add", row: row("a", { config }) }])).digest
    expect(withConfig(bare)).toBe(withConfig({ x: 1 }))
  })

  it("survives cyclic config", () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    const result = botPreset([{ op: "add", row: row("a", { config: cyclic }) }])
    expect(ok(result).digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("repeats shared (non-cyclic) subtrees by value", () => {
    const shared = { x: 1 }
    const a = presetDigest(
      { id: "p", name: "n", order: 1, plugins: [row("a", { config: [shared, shared] })] },
      [],
    )
    const b = presetDigest(
      { id: "p", name: "n", order: 1, plugins: [row("a", { config: [{ x: 1 }, { x: 1 }] })] },
      [],
    )
    expect(a).toBe(b)
  })
})

describe("composeBotPreset and the bot environment", () => {
  const environment = frozen({
    id: "vm",
    isolate: ["ssh", "fs", "subprocess", "shell", "sandboxPolicy"],
    rows: [
      { id: "env-ssh", name: "@x/ssh", config: { host: "dsh-bot-b1" } },
      { id: "env-fs", name: "@x/fs" },
    ],
  })

  it("puts the environment's rows first in one isolated group holding the composition", () => {
    const result = ok(botPreset([{ op: "remove", id: "planning" }], { environment }))
    expect(result.preset.plugins).toEqual([
      {
        id: "bot-environment",
        name: "cordis:group",
        group: true,
        isolate: expect.objectContaining({
          ssh: true,
          fs: true,
          subprocess: true,
          shell: true,
          sandboxPolicy: true,
          terminals: true,
          ptcRuntime: true,
          skills: true,
        }),
        config: [
          ...environment.rows,
          {
            id: "env-bot-core-files",
            name: "@1outres/dsh-bot-core/files",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-channel",
            name: "@1outres/dsh-bot-core/channel",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-connectors",
            name: "@1outres/dsh-bot-core/connectors",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-vaults",
            name: "@1outres/dsh-bot-core/vaults",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-vault-guard",
            name: "@1outres/dsh-bot-core/vault-guard",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-schedule",
            name: "@1outres/dsh-bot-core/schedule",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-sessions",
            name: "@1outres/dsh-bot-core/sessions",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-peers",
            name: "@1outres/dsh-bot-core/peers",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-prompt",
            name: "@1outres/dsh-bot-core/prompt",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-notes",
            name: "@1outres/dsh-bot-core/notes",
            config: { botId: "b1", token: result.revisionToken },
          },
          { id: "env-bot-core-skill", name: "@deepseek-ai/dsh-skill" },
          {
            id: "env-bot-core-skills",
            name: "@1outres/dsh-bot-core/skills",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-conversations",
            name: "@1outres/dsh-bot-core/conversations",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-settings",
            name: "@1outres/dsh-bot-core/settings",
            config: { botId: "b1", token: result.revisionToken },
          },
          {
            id: "env-bot-core-spaces",
            name: "@1outres/dsh-bot-core/spaces",
            config: { botId: "b1", token: result.revisionToken },
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
              botId: "b1",
              token: result.revisionToken,
              backend: "exa",
              search: true,
              fetch: true,
            },
          },
          { id: "env-bot-core-present", name: "@deepseek-ai/dsh-tool-present" },
          {
            id: "env-bot-core-compaction",
            name: "@1outres/dsh-bot-core/compaction",
            config: { botId: "b1", token: result.revisionToken },
          },
          ...template().plugins.slice(0, 2),
        ],
      },
    ])
    expect(
      ok(botPreset([{ op: "remove", id: "persona" }], { environment })).preset.plugins,
    ).toHaveLength(1)
  })

  it("seals the revision's token into bot-core's files row", () => {
    const plain = ok(botPreset([], { environment, seal: (revision) => revision }))
    expect(plain.revisionToken).toMatch(/^[0-9a-f]{64}$/)
    const sealed = ok(botPreset([], { environment }))
    expect(sealed.revisionToken).toBe(`sealed:${plain.revisionToken}`)
    expect(
      ok(botPreset([{ op: "remove", id: "persona" }], { environment })).revisionToken,
    ).not.toBe(sealed.revisionToken)
  })

  it("composes nothing registrable without an environment and a seal", () => {
    expectTypeOf<RowsComposition>().not.toHaveProperty("preset")
    expectTypeOf<RowsComposition>().not.toHaveProperty("revisionToken")
    expectTypeOf<Extract<BotPresetResult, { ok: true }>["revisionToken"]>().toEqualTypeOf<string>()
    const input = {
      botId: "b1",
      botName: "B",
      template: template(),
      overlay: [],
      allowedHostTools: ALLOWED_HOST_TOOLS,
      web: { backend: "exa", search: true, fetch: true },
    }
    // @ts-expect-error
    expect(() => composeBotPreset({ ...input, seal })).toThrow()
    // @ts-expect-error
    expect(() => composeBotPreset({ ...input, environment })).toThrow()
  })

  it("refuses an environment whose rows use bot-core's own rows", () => {
    const files = { id: "env-bot-core-files", name: "@x/other" }
    const channel = { id: "env-bot-core-channel", name: "@x/other" }
    const prompt = { id: "env-bot-core-prompt", name: "@x/other" }
    const promptPlugin = { id: "env-z", name: "@1outres/dsh-bot-core/prompt" }
    const notes = { id: "env-bot-core-notes", name: "@x/other" }
    const notesPlugin = { id: "env-w", name: "@1outres/dsh-bot-core/notes" }
    const skills = { id: "env-bot-core-skills", name: "@x/other" }
    const skillRegistry = { id: "env-v", name: "@deepseek-ai/dsh-skill" }
    const named = { id: "env-x", name: "@1outres/dsh-bot-core/channel", config: { botId: "b1" } }
    const nested = {
      id: "env-group",
      name: "cordis:group",
      group: true,
      config: [{ ...named, id: "env-y" }],
    }
    for (const row of [
      files,
      channel,
      prompt,
      promptPlugin,
      notes,
      notesPlugin,
      skills,
      skillRegistry,
      named,
      nested,
    ]) {
      const result = botPreset([], {
        environment: { ...environment, rows: [...environment.rows, row] },
      })
      expect(result).toMatchObject({
        ok: false,
        problem: expect.stringContaining("bot-core's own row"),
      })
    }
  })

  it("refuses rows that provide skills: a bot's skills are skills/ of its workspace", () => {
    for (const name of [
      "@deepseek-ai/dsh-skill",
      "@deepseek-ai/dsh-skill-filesystem",
      "@deepseek-ai/dsh-skill-office",
    ]) {
      expect(
        botPreset([{ op: "add", row: { id: "skills-x", name } }], { environment }),
      ).toMatchObject({
        ok: false,
        problem: expect.stringContaining("provides skills"),
      })
    }
  })

  it("changes the digest with the environment's rows and isolate list, not with the bot's name", () => {
    const base = ok(botPreset([], { environment })).digest
    expect(ok(botPreset([])).digest).not.toBe(base)
    expect(ok(botPreset([], { environment, botName: "Other" })).digest).toBe(base)
    const rows = [{ id: "env-ssh", name: "@x/ssh", config: { host: "other" } }]
    expect(ok(botPreset([], { environment: { ...environment, rows } })).digest).not.toBe(base)
    expect(ok(botPreset([], { environment: { ...environment, isolate: ["fs"] } })).digest).toBe(
      base,
    )
    expect(
      ok(botPreset([], { environment: { ...environment, isolate: ["custom"] } })).digest,
    ).not.toBe(base)
  })

  it("reserves the group id and env- ids, in templates and overlays, nested too", () => {
    for (const id of ["bot-environment", "env-x"]) {
      expect(problem(templateRows([{ op: "add", row: row(id) }]))).toContain("reserved")
      const nested = row("g", { name: "cordis:group", group: true, config: [row(id)] })
      expect(problem(templateRows([{ op: "add", row: nested }]))).toContain("reserved")
      const plugins = [...template().plugins, row(id)]
      expect(problem(templateRows([], { template: template({ plugins }) }))).toContain("reserved")
    }
  })

  it("refuses Host-execution packages, subpaths and prefixes included", () => {
    for (const name of [
      "@deepseek-ai/dsh-tool-pwsh",
      "@deepseek-ai/dsh-fs-local",
      "@deepseek-ai/dsh-bash-local",
      "@deepseek-ai/dsh-pwsh-windows",
      "@deepseek-ai/dsh-terminal-pty",
      "@deepseek-ai/dsh-tool-executor-ptc",
      "@deepseek-ai/dsh-tool-working-directory",
      "@deepseek-ai/DSH-SSH",
      "@1outres/dsh-bot-vm/ssh",
    ]) {
      expect(problem(templateRows([{ op: "add", row: { id: "x", name } }]))).toContain(
        "runs on the Host",
      )
      const plugins = [...template().plugins, { id: "x", name }]
      expect(problem(botPreset([], { template: template({ plugins }), environment }))).toContain(
        "runs on the Host",
      )
    }
    const plugins = [...template().plugins, { id: "pwsh", name: "@deepseek-ai/dsh-tool-pwsh" }]
    ok(templateRows([{ op: "remove", id: "pwsh" }], { template: template({ plugins }) }))
    ok(templateRows([{ op: "add", row: { id: "x", name: "@deepseek-ai/dsh-tool-fs" } }]))
  })

  it("refuses present anywhere but bot-core's own row: templates, overlays, nested, environments, hostTools", () => {
    for (const name of ["@deepseek-ai/dsh-tool-present", "@deepseek-ai/dsh-tool-present/lib"]) {
      const own = "bot-core puts in every bot's preset itself"
      expect(problem(templateRows([{ op: "add", row: { id: "x", name } }]))).toContain(own)
      const nested = row("g", { name: "cordis:group", group: true, config: [{ id: "x", name }] })
      expect(problem(templateRows([{ op: "add", row: nested }]))).toContain(own)
      const plugins = [...template().plugins, { id: "x", name }]
      expect(problem(botPreset([], { template: template({ plugins }), environment }))).toContain(
        own,
      )
    }
    const present = { id: "env-present", name: "@deepseek-ai/dsh-tool-present" }
    expect(
      problem(
        botPreset([], { environment: { ...environment, rows: [...environment.rows, present] } }),
      ),
    ).toContain("bot-core's own row")
    expect(
      problem(
        templateRows([], {
          template: template({ hostTools: ["present"] }),
          allowedHostTools: new Set(["present"]),
        }),
      ),
    ).toContain('Host tool "present", which reads Host paths')
  })

  it("refuses a group that isolates an environment service", () => {
    const group = (isolate: Record<string, boolean>) =>
      row("g", { name: "cordis:group", group: true, isolate, config: [row("inner")] })
    expect(problem(templateRows([{ op: "add", row: group({ fs: true }) }]))).toContain(
      'isolates "fs"',
    )
    expect(
      problem(
        botPreset([{ op: "add", row: group({ custom: true }) }], {
          environment: { ...environment, isolate: ["custom"] },
        }),
      ),
    ).toContain('isolates "custom"')
    ok(botPreset([{ op: "add", row: group({ other: true }) }], { environment }))
    expect(problem(templateRows([{ op: "add", row: group({ other: false }) }]))).toContain(
      "only true is accepted",
    )
    expect(
      problem(templateRows([{ op: "add", row: { ...group({}), isolate: { other: "shared" } } }])),
    ).toContain("only true is accepted")
  })

  it("refuses an environment layer with ids outside env- or a malformed isolate list", () => {
    expect(
      problem(botPreset([], { environment: { ...environment, rows: [row("ssh")] } })),
    ).toContain('does not start with "env-"')
    const nested = row("env-g", { name: "cordis:group", group: true, config: [row("x")] })
    expect(problem(botPreset([], { environment: { ...environment, rows: [nested] } }))).toContain(
      '"x" does not start',
    )
    expect(problem(botPreset([], { environment: { ...environment, isolate: [""] } }))).toContain(
      "isolate",
    )
    expect(
      problem(
        botPreset([], {
          environment: { ...environment, rows: [row("env-a"), row("env-a")] },
        }),
      ),
    ).toContain("repeats")
  })
})

describe("composition: rows the Loader mounts whatever the group flag says", () => {
  const smuggle = (extra: Partial<PluginRow>, children: PluginRow[]) =>
    templateRows([
      {
        op: "add",
        row: { id: "g", name: "cordis:group", config: children, ...extra } as PluginRow,
      },
    ])

  it("refuses a cordis:group row without group: true (its children would mount unchecked)", () => {
    const hostShell = [{ id: "x", name: "@deepseek-ai/dsh-bash-local" }]
    expect(problem(smuggle({}, hostShell))).toContain('without "group: true"')
    expect(problem(smuggle({ group: false }, hostShell))).toContain('without "group: true"')
    expect(problem(smuggle({}, [{ id: "env-ssh", name: "@x/ssh" }]))).toContain(
      'without "group: true"',
    )
  })

  it("checks the children of a proper group like top-level rows", () => {
    expect(
      problem(smuggle({ group: true }, [{ id: "x", name: "@deepseek-ai/dsh-bash-local" }])),
    ).toContain("runs on the Host")
    expect(problem(smuggle({ group: true }, [{ id: "env-ssh", name: "@x/ssh" }]))).toContain(
      "reserved",
    )
    expect(
      problem(
        smuggle({ group: true }, [
          { id: "sub", name: "@x/sub", config: { agentPreset: "standard" } },
        ]),
      ),
    ).toContain("own preset")
    expect(problem(smuggle({ group: true }, [{ id: "persona", name: "@x/p" }]))).toContain(
      "repeats the id",
    )
  })

  it("refuses other row carriers and group: true on anything but cordis:group", () => {
    for (const name of [
      "@deepseek-ai/cordis-plugin-group",
      "@deepseek-ai/dsh-agent-preset",
      "@1outres/dsh-bot-core/template",
    ]) {
      expect(problem(templateRows([{ op: "add", row: { id: "x", name, config: [] } }]))).toContain(
        "carries rows",
      )
    }
    expect(
      problem(
        templateRows([{ op: "add", row: { id: "x", name: "@x/y", group: true, config: [] } }]),
      ),
    ).toContain('only "cordis:group" rows may be groups')
  })

  it("refuses paths, URLs and Loader builtins in templates too", () => {
    for (const name of ["/tmp/evil.mjs", "./evil.mjs", "file:///evil.mjs", "cordis:include"]) {
      const plugins = [...template().plugins, { id: "x", name }]
      expect(problem(templateRows([], { template: template({ plugins }) }))).toContain("path, URL")
    }
  })

  it("refuses the extended Host-execution list", () => {
    for (const name of [
      "@deepseek-ai/dsh-tool-pwsh-persistent",
      "@deepseek-ai/dsh-mcp-client",
      "@deepseek-ai/dsh-mcp-manager",
      "@deepseek-ai/dsh-plugin-manager/tools",
      "@deepseek-ai/dsh-tool-cordis",
      "@deepseek-ai/dsh-tool-session-query",
      "@deepseek-ai/dsh-cua",
      "@deepseek-ai/dsh-computer-use",
      "@deepseek-ai/dsh-experimental-tool-worktree",
      "@deepseek-ai/dsh-experimental-worktree",
      "@deepseek-ai/dsh-experimental-liveshare",
      "@deepseek-ai/dsh-native-command",
    ]) {
      expect(problem(templateRows([{ op: "add", row: { id: "x", name } }]))).toContain(
        "runs on the Host",
      )
    }
  })

  it("refuses an intercept of an environment service", () => {
    expect(
      problem(
        templateRows([{ op: "add", row: { id: "x", name: "@x/x", intercept: { fs: { a: 1 } } } }]),
      ),
    ).toContain('intercepts "fs"')
  })

  it("allows only the configured Host tools", () => {
    const allowedHostTools = new Set(["web_search", "ask_user_question"])
    ok(templateRows([], { allowedHostTools }))
    expect(problem(templateRows([], { allowedHostTools: new Set(["web_search"]) }))).toContain(
      'Host tool "ask_user_question"',
    )
  })
})

describe("composeBotPreset: byte-identical to the composition before the split", () => {
  const workspace = "/home/bot/workspace"
  const vmLayer = (botId: string): EnvironmentLayer => ({
    id: "vm",
    isolate: ["ssh", "fs", "subprocess", "shell", "sandboxPolicy"],
    rows: [
      {
        id: "env-ssh",
        name: "@1outres/dsh-bot-vm/ssh",
        config: {
          host: `dsh-bot-${botId}`,
          launch: { kind: "node-script", node: "/usr/bin/node" },
          helper: "/opt/dsh/helper.js",
          helperHash: "ab".repeat(32),
          workspace,
          requestTimeoutMs: 30000,
        },
      },
      {
        id: "env-sandbox-policy",
        name: "@1outres/dsh-bot-vm/full-access-policy",
        config: { workspaceRoot: workspace },
      },
      { id: "env-fs", name: "@deepseek-ai/dsh-fs-ssh" },
      { id: "env-subprocess", name: "@deepseek-ai/dsh-subprocess-ssh" },
      { id: "env-shell", name: "@deepseek-ai/dsh-bash-local", config: { cwd: workspace } },
    ],
  })
  const hmac = (revision: string) =>
    createHmac("sha256", "h1-golden").update(revision).digest("hex")
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const persona = defaultTemplate().plugins[0] as PluginRow
  const cases: readonly {
    name: string
    botId: string
    botName: string
    template: BotTemplate
    overlay: BotOverlay
    digest: string
    revisionToken: string
    preset: string
  }[] = [
    {
      name: "the default template",
      botId: "mia",
      botName: "Mia",
      template: defaultTemplate(),
      overlay: [],
      digest: "2de4f0001ad118441e27991352a8aebec198801967daecb8359746c3bc156ae5",
      revisionToken: "e8f8c0648eb9671ae57ccbaea20309a5b09c3ea5f3f4906327087796febcbeb1",
      preset: "9b247e140bf9601c1a3ec4541f21f91b597a45688ff3ae2de5df78461046ec42",
    },
    {
      name: "a replaced persona",
      botId: "b-2",
      botName: "Bob",
      template: defaultTemplate(),
      overlay: [
        {
          op: "replace",
          id: persona.id,
          row: { ...persona, config: { prefix: "You are Bob." } },
        },
      ],
      digest: "5d9bf45300861213c6d917243f71bac62546ef914489da32508da669539d8601",
      revisionToken: "de3663983051135dc95809525a7e50c781b2fc4331900b03661eb92b0ca5b55b",
      preset: "596565aa201f06a83a959eade9912133a07a4c91dd29e5475872174f1e610b81",
    },
    {
      name: "a removed row and an added group",
      botId: "c3",
      botName: "C",
      template: defaultTemplate(),
      overlay: [
        { op: "remove", id: "tool-web" },
        {
          op: "add",
          row: {
            id: "extra",
            name: "cordis:group",
            group: true,
            config: [
              {
                id: "inner",
                name: "@deepseek-ai/dsh-tool-web",
                config: { b: 1, a: [2, { z: null }] },
              },
            ],
          },
        },
      ],
      digest: "1a899b3123b2e5cff3f5334a1dda67380f49b1cb43ced4e1ffc26c6b05bb8708",
      revisionToken: "03ea18f7b2708777250c19cfcd03864ed33dd515b1051750dabc0dc2787dbf2d",
      preset: "03600fa8df492e3885acd77ad3ff065d632f459dbc8de3efca84323e0e0d9fed",
    },
    {
      name: "host tools",
      botId: "d4",
      botName: "D",
      template: {
        ...defaultTemplate(),
        id: "with-tools",
        name: "With tools",
        hostTools: ["web_search", "ask", "web_search"],
      },
      overlay: [],
      digest: "88c5e6b9254bf9315a2297bce937e684ee178c58d3d247292aed0692373b65bd",
      revisionToken: "1f0a5d26df61d55a5233448529535630030cad515501c5072d47b7cbf0cb9c43",
      preset: "25e6fcf4f1d73769934c6cea182661af1eee034d0b9c8d38ccd18922975f3d34",
    },
  ]
  for (const expected of cases) {
    it(`keeps the preset, digest and files token of ${expected.name}`, () => {
      const result = ok(
        composeBotPreset({
          botId: expected.botId,
          botName: expected.botName,
          template: expected.template,
          overlay: expected.overlay,
          allowedHostTools: new Set(["ask", "web_search"]),
          web: { backend: "exa", search: true, fetch: true },
          environment: vmLayer(expected.botId),
          seal: hmac,
        }),
      )
      expect(result.digest).toBe(expected.digest)
      expect(result.revisionToken).toBe(expected.revisionToken)
      expect(sha(result.preset)).toBe(expected.preset)
    })
  }
})
