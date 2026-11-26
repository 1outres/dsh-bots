import type { EnvironmentPhase } from "./bots"

export const BOT_ENVIRONMENT_SPEC_KEYS = ["cpus", "memoryMiB", "diskGiB"] as const

export type BotEnvironmentSpecKey = (typeof BOT_ENVIRONMENT_SPEC_KEYS)[number]

export type BotEnvironmentSpec = { readonly [Key in BotEnvironmentSpecKey]: number }

export type BotEnvironmentMinimum = { readonly [Key in BotEnvironmentSpecKey]?: number }

export interface BotEnvironmentRange {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly growOnly?: true
}

export type BotEnvironmentCapacity = {
  readonly [Key in BotEnvironmentSpecKey]: BotEnvironmentRange
}

export const DEFAULT_BOT_ENVIRONMENT_SPEC: BotEnvironmentSpec = {
  cpus: 4,
  memoryMiB: 6144,
  diskGiB: 20,
}

export interface BotEnvironmentNeed {
  readonly connector: string
  readonly minimum: BotEnvironmentMinimum
}

export type BotEnvironmentSpecProblem =
  | {
      readonly kind: "range"
      readonly key: BotEnvironmentSpecKey
      readonly range: BotEnvironmentRange
    }
  | { readonly kind: "shrink"; readonly key: BotEnvironmentSpecKey; readonly current: number }
  | {
      readonly kind: "needed"
      readonly key: BotEnvironmentSpecKey
      readonly need: number
      readonly connectors: readonly string[]
    }

export function sameEnvironmentSpec(a: BotEnvironmentSpec, b: BotEnvironmentSpec): boolean {
  return BOT_ENVIRONMENT_SPEC_KEYS.every((key) => a[key] === b[key])
}

export function withinRange(range: BotEnvironmentRange, value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= range.min &&
    value <= range.max &&
    value % range.step === 0
  )
}

export function environmentSpecProblems(
  current: BotEnvironmentSpec,
  next: BotEnvironmentSpec,
  capacity: BotEnvironmentCapacity,
  needs: readonly BotEnvironmentNeed[],
): readonly BotEnvironmentSpecProblem[] {
  return BOT_ENVIRONMENT_SPEC_KEYS.flatMap((key): BotEnvironmentSpecProblem[] => {
    const value = next[key]
    if (value === current[key]) return []
    const range = capacity[key]
    if (!withinRange(range, value)) return [{ kind: "range", key, range }]
    if (value > current[key]) return []
    if (range.growOnly === true) return [{ kind: "shrink", key, current: current[key] }]
    const short = needs.filter((need) => (need.minimum[key] ?? 0) > value)
    if (short.length === 0) return []
    return [
      {
        kind: "needed",
        key,
        need: Math.max(...short.map((need) => need.minimum[key] ?? 0)),
        connectors: short.map((need) => need.connector),
      },
    ]
  })
}

export function environmentShortfall(
  minimum: BotEnvironmentMinimum,
  spec: BotEnvironmentSpec,
): { readonly key: BotEnvironmentSpecKey; readonly need: number } | undefined {
  for (const key of BOT_ENVIRONMENT_SPEC_KEYS) {
    const need = minimum[key]
    if (need !== undefined && spec[key] < need) return { key, need }
  }
  return undefined
}

export interface BotEnvironmentCapacityShortfall {
  readonly key: BotEnvironmentSpecKey
  readonly need: number
  readonly available: number
  readonly connectors: readonly string[]
}

export type InitialEnvironmentSpec =
  | { readonly ok: true; readonly spec: BotEnvironmentSpec }
  | { readonly ok: false; readonly shortfalls: readonly BotEnvironmentCapacityShortfall[] }

const stepDown = (value: number, step: number) => Math.floor(value / step) * step
const stepUp = (value: number, step: number) => Math.ceil(value / step) * step

export function initialEnvironmentSpec(
  capacity: BotEnvironmentCapacity,
  needs: readonly BotEnvironmentNeed[],
): InitialEnvironmentSpec {
  const spec: Partial<Record<BotEnvironmentSpecKey, number>> = {}
  const shortfalls: BotEnvironmentCapacityShortfall[] = []
  for (const key of BOT_ENVIRONMENT_SPEC_KEYS) {
    const range = capacity[key]
    const available = stepDown(range.max, range.step)
    const needed = Math.max(...needs.map((need) => need.minimum[key] ?? 0))
    const least = stepUp(Math.max(range.min, needed), range.step)
    if (least > available) {
      shortfalls.push({
        key,
        need: Math.max(range.min, needed),
        available,
        connectors: needs
          .filter((need) => (need.minimum[key] ?? 0) > available)
          .map((need) => need.connector),
      })
      continue
    }
    spec[key] = Math.min(
      Math.max(stepDown(DEFAULT_BOT_ENVIRONMENT_SPEC[key], range.step), least),
      available,
    )
  }
  return shortfalls.length > 0
    ? { ok: false, shortfalls }
    : { ok: true, spec: spec as BotEnvironmentSpec }
}

export function parseEnvironmentSpec(input: unknown): BotEnvironmentSpec {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("the spec must be an object")
  }
  const value = input as Record<string, unknown>
  const unknown = Object.keys(value).filter(
    (key) => !(BOT_ENVIRONMENT_SPEC_KEYS as readonly string[]).includes(key),
  )
  if (unknown.length > 0) throw new Error(`the spec has unknown keys: ${unknown.join(", ")}`)
  return Object.fromEntries(
    BOT_ENVIRONMENT_SPEC_KEYS.map((key) => {
      const field = value[key]
      if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 1) {
        throw new Error(`${key} must be a positive integer`)
      }
      return [key, field]
    }),
  ) as BotEnvironmentSpec
}

const UNIT: { readonly [Key in BotEnvironmentSpecKey]: (value: number) => string } = {
  cpus: (value) => `${value} CPU${value === 1 ? "" : "s"}`,
  memoryMiB: (value) => (value % 1024 === 0 ? `${value / 1024} GiB` : `${value} MiB`),
  diskGiB: (value) => `${value} GiB`,
}

const NOUN: { readonly [Key in BotEnvironmentSpecKey]: string } = {
  cpus: "CPUs",
  memoryMiB: "memory",
  diskGiB: "workspace disk",
}

export const environmentValueText = (key: BotEnvironmentSpecKey, value: number) => UNIT[key](value)

export function environmentSpecRefusal(problem: BotEnvironmentSpecProblem): string {
  const noun = NOUN[problem.key]
  switch (problem.kind) {
    case "range":
      return `${noun} must be from ${environmentValueText(problem.key, problem.range.min)} to ${environmentValueText(problem.key, problem.range.max)} in steps of ${environmentValueText(problem.key, problem.range.step)}`
    case "shrink":
      return `the ${noun} cannot be made smaller than ${environmentValueText(problem.key, problem.current)}`
    case "needed":
      return `${problem.connectors.join(", ")} ${problem.connectors.length === 1 ? "needs" : "need"} ${environmentValueText(problem.key, problem.need)} of ${noun} or more`
  }
}

export function environmentCapacityShortfallText(
  shortfall: BotEnvironmentCapacityShortfall,
): string {
  const noun = NOUN[shortfall.key]
  const need = environmentValueText(shortfall.key, shortfall.need)
  const available = environmentValueText(shortfall.key, shortfall.available)
  return shortfall.connectors.length === 0
    ? `this Host cannot give a bot's VM the ${need} of ${noun} it needs at least (at most ${available})`
    : `${shortfall.connectors.join(", ")} ${shortfall.connectors.length === 1 ? "needs" : "need"} ${need} of ${noun}, but this Host can give a bot's VM at most ${available}`
}

export function environmentShortfallText(
  connector: string,
  shortfall: { readonly key: BotEnvironmentSpecKey; readonly need: number },
): string {
  return `${connector} needs ${environmentValueText(shortfall.key, shortfall.need)} of ${NOUN[shortfall.key]} or more: raise it on the bot's VM page first`
}

export type BotEnvironmentApplication =
  | { readonly state: "unread"; readonly reason: string }
  | { readonly state: "applying"; readonly phase?: EnvironmentPhase }
  | { readonly state: "applied" }
  | { readonly state: "failed"; readonly reason: string }

export type BotEnvironmentCapacityState =
  | { readonly status: "ready"; readonly capacity: BotEnvironmentCapacity }
  | { readonly status: "unavailable"; readonly reason: string }

export interface BotEnvironmentView {
  readonly botId: string
  readonly spec?: BotEnvironmentSpec
  readonly capacity: BotEnvironmentCapacityState
  readonly needs: readonly BotEnvironmentNeed[]
  readonly application: BotEnvironmentApplication
}

export interface BotEnvironmentApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotEnvironmentView>
  configure(botId: string, spec: BotEnvironmentSpec): Promise<BotEnvironmentView>
}
