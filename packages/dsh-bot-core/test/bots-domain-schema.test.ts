import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { CHANNELS_DOMAIN } from "../src/host/channels/domain"
import { CONNECTIONS_DOMAIN } from "../src/host/connections/domain"
import { CONNECTORS_DOMAIN } from "../src/host/connectors/domain"
import { BOTS_DOMAIN } from "../src/host/domain"
import { EVENTS_DOMAIN } from "../src/host/events/domain"
import { MAINS_DOMAIN } from "../src/host/mains/domain"
import { MANAGED_SESSIONS_DOMAIN } from "../src/host/managed/domain"
import { MODELS_DOMAIN } from "../src/host/models/domain"
import { NOTICES_DOMAIN } from "../src/host/notices/domain"
import { ONBOARDING_DOMAIN } from "../src/host/onboarding/domain"
import { SCHEDULES_DOMAIN } from "../src/host/schedule/domain"
import { SKILLS_DOMAIN } from "../src/host/skills/domain"
import { VAULTS_DOMAIN } from "../src/host/vaults/domain"
import { WEB_DOMAIN } from "../src/host/web/domain"

/**
 * Design rule 27: the stored bot records keep their shape unless the storage
 * domain's version goes up. The snapshot keeps, per table, every field with
 * whether it is required and a summary of its type (constraints such as
 * minLength left out). A new required field, an optional field made required
 * or a changed type breaks records already stored, so it needs a version bump;
 * any other change (a new optional field) only needs the snapshot updated.
 * Two type changes are compatible, since every stored value still parses:
 * widening a field to any JSON value (or an array to an array of any JSON
 * value), and adding literals to a union of literals (an enum).
 *
 * The rule guards upward compatibility only: records stored by an older
 * version must parse under the current schema. Whether an older version can
 * read records the current one writes (a downgrade) is not checked.
 */

const UPDATE = "pnpm vitest run packages/dsh-bot-core/test/bots-domain-schema.test.ts --update"

/** Every storage domain bot-core declares, with its snapshot file. */
const DOMAINS = [
  { label: "BOTS_DOMAIN", source: "src/host/domain.ts", domain: BOTS_DOMAIN, file: "bots-domain" },
  {
    label: "CHANNELS_DOMAIN",
    source: "src/host/channels/domain.ts",
    domain: CHANNELS_DOMAIN,
    file: "channels-domain",
  },
  {
    label: "CONNECTORS_DOMAIN",
    source: "src/host/connectors/domain.ts",
    domain: CONNECTORS_DOMAIN,
    file: "connectors-domain",
  },
  {
    label: "CONNECTIONS_DOMAIN",
    source: "src/host/connections/domain.ts",
    domain: CONNECTIONS_DOMAIN,
    file: "connections-domain",
  },
  {
    label: "EVENTS_DOMAIN",
    source: "src/host/events/domain.ts",
    domain: EVENTS_DOMAIN,
    file: "events-domain",
  },
  {
    label: "MAINS_DOMAIN",
    source: "src/host/mains/domain.ts",
    domain: MAINS_DOMAIN,
    file: "mains-domain",
  },
  {
    label: "MANAGED_SESSIONS_DOMAIN",
    source: "src/host/managed/domain.ts",
    domain: MANAGED_SESSIONS_DOMAIN,
    file: "managed-sessions-domain",
  },
  {
    label: "MODELS_DOMAIN",
    source: "src/host/models/domain.ts",
    domain: MODELS_DOMAIN,
    file: "models-domain",
  },
  {
    label: "NOTICES_DOMAIN",
    source: "src/host/notices/domain.ts",
    domain: NOTICES_DOMAIN,
    file: "notices-domain",
  },
  {
    label: "ONBOARDING_DOMAIN",
    source: "src/host/onboarding/domain.ts",
    domain: ONBOARDING_DOMAIN,
    file: "onboarding-domain",
  },
  {
    label: "SCHEDULES_DOMAIN",
    source: "src/host/schedule/domain.ts",
    domain: SCHEDULES_DOMAIN,
    file: "schedules-domain",
  },
  { label: "WEB_DOMAIN", source: "src/host/web/domain.ts", domain: WEB_DOMAIN, file: "web-domain" },
  {
    label: "VAULTS_DOMAIN",
    source: "src/host/vaults/domain.ts",
    domain: VAULTS_DOMAIN,
    file: "vaults-domain",
  },
  {
    label: "SKILLS_DOMAIN",
    source: "src/host/skills/domain.ts",
    domain: SKILLS_DOMAIN,
    file: "skills-domain",
  },
] as const

interface DomainSpec {
  readonly name: string
  readonly version: number
  readonly tables: Readonly<Record<string, { readonly valueSchema: z.ZodType }>>
}

type JsonSchema = Record<string, unknown>

interface FieldSummary {
  required: boolean
  type: string
}

interface DomainSnapshot {
  name: string
  version: number
  tables: Record<string, Record<string, FieldSummary>>
}

/** A compact, constraint-free type string of a JSON Schema node. */
function typeOf(node: JsonSchema, defs: Record<string, JsonSchema>, seen: string[] = []): string {
  const ref = typeof node.$ref === "string" ? node.$ref.replace("#/$defs/", "") : undefined
  if (ref !== undefined) {
    if (seen.includes(ref)) return "json"
    return typeOf(defs[ref] ?? {}, defs, [...seen, ref])
  }
  const alternatives = (node.oneOf ?? node.anyOf) as JsonSchema[] | undefined
  if (alternatives !== undefined) {
    return alternatives.map((alternative) => typeOf(alternative, defs, seen)).join(" | ")
  }
  if ("const" in node) return JSON.stringify(node.const)
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ")
  if (node.type === "array") {
    const items = typeOf((node.items as JsonSchema | undefined) ?? {}, defs, seen)
    return items.includes(" | ") ? `(${items})[]` : `${items}[]`
  }
  if (node.type === "object") {
    const required = new Set((node.required as string[] | undefined) ?? [])
    const fields = Object.entries((node.properties as Record<string, JsonSchema>) ?? {}).map(
      ([key, value]) => `${key}${required.has(key) ? "" : "?"}: ${typeOf(value, defs, seen)}`,
    )
    const rest = node.additionalProperties
    if (typeof rest === "object" && rest !== null) {
      fields.push(`[key: string]: ${typeOf(rest as JsonSchema, defs, seen)}`)
    }
    return `{ ${fields.join("; ")} }`
  }
  if (node.type === "integer") return "number"
  return typeof node.type === "string" ? node.type : "unknown"
}

function snapshotOf(domain: DomainSpec): DomainSnapshot {
  const tables: DomainSnapshot["tables"] = {}
  for (const [table, spec] of Object.entries(domain.tables)) {
    const schema = z.toJSONSchema(spec.valueSchema, { io: "input", unrepresentable: "any" })
    const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>
    const required = new Set(schema.required ?? [])
    tables[table] = Object.fromEntries(
      Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>).map(
        ([field, value]) => [field, { required: required.has(field), type: typeOf(value, defs) }],
      ),
    )
  }
  return { name: domain.name, version: domain.version, tables }
}

/** The summary of `z.json()`: any JSON value. */
const ANY_JSON = "string | number | boolean | null | json[] | { [key: string]: json }"

/**
 * Whether a type summary is an array as a whole: `X[]` or `(A | B)[]` whose
 * parenthesis closes at the end, not a union whose last member is an array
 * (`string | number[]`).
 */
export function isArrayType(type: string): boolean {
  if (!type.endsWith("[]")) return false
  const element = type.slice(0, -2)
  let depth = 0
  for (const [index, char] of [...element].entries()) {
    if (char === "(" || char === "{") depth += 1
    else if (char === ")" || char === "}") depth -= 1
    // A top-level "|" before the end: a union, not one array.
    else if (char === "|" && depth === 0) return false
    // A parenthesis that closes before the end: "(A) | B[]" style.
    if (depth === 0 && char === ")" && index !== element.length - 1) return false
  }
  return depth === 0
}

/** Whether `next` accepts every value `previous` did, by widening to any JSON. */
export function widensToJson(previous: string, next: string): boolean {
  if (next === ANY_JSON) return true
  return next === `(${ANY_JSON})[]` && isArrayType(previous)
}

const LITERAL_UNION = /"(?:[^"\\]|\\.)*"(?: \| "(?:[^"\\]|\\.)*")*/g

/**
 * Whether `next` is `previous` with literals added to its unions of literals:
 * the rest of the type is the same, and each union keeps all it had.
 */
export function widensLiterals(previous: string, next: string): boolean {
  const unions = (type: string) => [...type.matchAll(LITERAL_UNION)].map((match) => match[0])
  const skeleton = (type: string) => type.replace(LITERAL_UNION, "<literals>")
  if (skeleton(previous) !== skeleton(next)) return false
  const before = unions(previous)
  const after = unions(next)
  return before.every((union, index) => {
    const kept = new Set((after[index] as string).split(" | "))
    return union.split(" | ").every((literal) => kept.has(literal))
  })
}

/** Changes that break records stored under the snapshot's version. */
export function breakingChanges(saved: DomainSnapshot, current: DomainSnapshot): string[] {
  const problems: string[] = []
  for (const [table, fields] of Object.entries(current.tables)) {
    const before = saved.tables[table] ?? {}
    for (const [field, summary] of Object.entries(fields)) {
      const old = before[field]
      if (old === undefined && summary.required)
        problems.push(`${table}.${field} is a new required field`)
      if (old !== undefined && summary.required && !old.required) {
        problems.push(`${table}.${field} became required`)
      }
      if (
        old !== undefined &&
        old.type !== summary.type &&
        !widensToJson(old.type, summary.type) &&
        !widensLiterals(old.type, summary.type)
      ) {
        problems.push(`${table}.${field} changed type: ${old.type} -> ${summary.type}`)
      }
    }
  }
  return problems
}

describe.each(DOMAINS)("$label schema (design rule 27)", ({ label, source, domain, file }) => {
  const snapshot = fileURLToPath(new URL(`./__snapshots__/${file}.schema.snap`, import.meta.url))
  const current = snapshotOf(domain)
  const saved = existsSync(snapshot)
    ? (JSON.parse(readFileSync(snapshot, "utf8")) as DomainSnapshot)
    : undefined
  /** Breaking changes made without a version bump; `--update` must not paper over them. */
  const unversioned =
    saved !== undefined && saved.version === current.version ? breakingChanges(saved, current) : []

  it("bumps the version for every change that breaks stored records", () => {
    expect(
      unversioned,
      `These changes break records stored under version ${saved?.version}. Raise ${label}.version in ${source} (and handle the older records), then update the snapshot: ${UPDATE}`,
    ).toEqual([])
  })

  it.skipIf(unversioned.length > 0)("matches the saved schema snapshot", async () => {
    await expect(
      `${JSON.stringify(current, null, 2)}\n`,
      `The ${label} schema differs from its snapshot. If the change is compatible (e.g. a new optional field) or the version was raised, update the snapshot: ${UPDATE}`,
    ).toMatchFileSnapshot(snapshot)
  })
})

describe("breakingChanges", () => {
  const base: DomainSnapshot = {
    name: "d",
    version: 1,
    tables: {
      bots: { name: { required: true, type: "string" }, note: { required: false, type: "string" } },
    },
  }
  const withFields = (fields: Record<string, FieldSummary>): DomainSnapshot => ({
    ...base,
    tables: { bots: { ...base.tables.bots, ...fields } },
  })

  it("accepts a new optional field", () => {
    expect(
      breakingChanges(base, withFields({ extra: { required: false, type: "number" } })),
    ).toEqual([])
  })

  it("tells a whole array from a union ending in an array", () => {
    expect(isArrayType("string[]")).toBe(true)
    expect(isArrayType('({ op: "a" } | { op: "b" })[]')).toBe(true)
    expect(isArrayType("{ a: string; b: number[] }[]")).toBe(true)
    expect(isArrayType("string | number[]")).toBe(false)
    expect(isArrayType("(string) | number[]")).toBe(false)
    expect(isArrayType("string")).toBe(false)
    expect(widensToJson("string | number[]", `(${ANY_JSON})[]`)).toBe(false)
  })

  it("accepts widening a field to any JSON value", () => {
    expect(
      breakingChanges(
        withFields({ list: { required: false, type: '({ op: "a" })[]' } }),
        withFields({
          list: { required: false, type: `(${ANY_JSON})[]` },
          note: { required: false, type: ANY_JSON },
        }),
      ),
    ).toEqual([])
    expect(
      breakingChanges(base, withFields({ note: { required: false, type: `(${ANY_JSON})[]` } })),
    ).toEqual([`bots.note changed type: string -> (${ANY_JSON})[]`])
  })

  it("accepts adding literals to an enum, not removing or renaming one", () => {
    const phase = (type: string) => withFields({ failure: { required: false, type } })
    const before = phase('{ phase: "a" | "b"; at: number }')
    expect(breakingChanges(before, phase('{ phase: "a" | "x" | "b"; at: number }'))).toEqual([])
    expect(breakingChanges(before, phase('{ phase: "a"; at: number }'))).toHaveLength(1)
    expect(breakingChanges(before, phase('{ phase: "a" | "c"; at: number }'))).toHaveLength(1)
    expect(breakingChanges(before, phase('{ phase: "a" | "b"; at: string }'))).toHaveLength(1)
    expect(widensLiterals('"a" | number', '"a" | "b" | number')).toBe(true)
    expect(widensLiterals('"a"', "string")).toBe(false)
  })

  it("refuses a new required field, a field made required and a type change", () => {
    expect(
      breakingChanges(
        base,
        withFields({
          extra: { required: true, type: "number" },
          note: { required: true, type: "string" },
          name: { required: true, type: "number" },
        }),
      ),
    ).toEqual([
      "bots.name changed type: string -> number",
      "bots.note became required",
      "bots.extra is a new required field",
    ])
  })
})
