import type { EnvironmentPhase } from "./bots"

/** What a bot's machine (its VM) is given, each a whole number of its unit. */
export const BOT_ENVIRONMENT_SPEC_KEYS = ["cpus", "memoryMiB", "diskGiB"] as const

export type BotEnvironmentSpecKey = (typeof BOT_ENVIRONMENT_SPEC_KEYS)[number]

/**
 * The CPUs, memory (MiB) and workspace disk (GiB) of a bot's environment:
 * `diskGiB` is the size of the disk holding the bot's files (its workspace),
 * not of the system the environment runs.
 */
export type BotEnvironmentSpec = { readonly [Key in BotEnvironmentSpecKey]: number }

/** The least of some keys a connector needs of the bot's environment while it is on. */
export type BotEnvironmentMinimum = { readonly [Key in BotEnvironmentSpecKey]?: number }

/** The values the environment accepts for one key: `min` to `max`, multiples of `step`. */
export interface BotEnvironmentRange {
  readonly min: number
  readonly max: number
  readonly step: number
  /** The value is never lowered (a disk cannot shrink). */
  readonly growOnly?: true
}

/** What the registered environment accepts for every key, read from the Host it runs on. */
export type BotEnvironmentCapacity = {
  readonly [Key in BotEnvironmentSpecKey]: BotEnvironmentRange
}

/**
 * What a new bot is created with where the Host can give it: enough for the
 * desktop and the browser together. {@link initialEnvironmentSpec} brings it
 * within the capacity of the Host the bot is created on.
 */
export const DEFAULT_BOT_ENVIRONMENT_SPEC: BotEnvironmentSpec = {
  cpus: 4,
  memoryMiB: 6144,
  diskGiB: 20,
}

/** What an enabled connector needs of the bot's environment, by its name. */
export interface BotEnvironmentNeed {
  readonly connector: string
  readonly minimum: BotEnvironmentMinimum
}

/**
 * Why a change of a bot's spec is refused, per key:
 * - `range`: not a multiple of `step` from `min` to `max`;
 * - `shrink`: lowered, though the key only grows;
 * - `needed`: lowered below `need`, what the enabled `connectors` (names) need.
 */
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

/** Whether `value` lies in `range`. */
export function withinRange(range: BotEnvironmentRange, value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= range.min &&
    value <= range.max &&
    value % range.step === 0
  )
}

/**
 * What is wrong with changing a bot's spec from `current` to `next`. Only
 * the keys that change are checked: a stored value outside today's range
 * stays as long as it is kept.
 */
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

/** The first key of `minimum` that `spec` falls short of, with what is needed. */
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

/**
 * A key a new bot's environment cannot be given on this Host: `need` (the
 * environment's own least value, or what `connectors` need when they ask
 * more) is above `available`, the most it accepts.
 */
export interface BotEnvironmentCapacityShortfall {
  readonly key: BotEnvironmentSpecKey
  readonly need: number
  readonly available: number
  /** The connectors needing more than `available`; empty when the environment's own least value is. */
  readonly connectors: readonly string[]
}

export type InitialEnvironmentSpec =
  | { readonly ok: true; readonly spec: BotEnvironmentSpec }
  | { readonly ok: false; readonly shortfalls: readonly BotEnvironmentCapacityShortfall[] }

const stepDown = (value: number, step: number) => Math.floor(value / step) * step
const stepUp = (value: number, step: number) => Math.ceil(value / step) * step

/**
 * The spec a new bot's environment starts with: each key of
 * {@link DEFAULT_BOT_ENVIRONMENT_SPEC} within `capacity` and at least what
 * `needs` (its connectors') ask; the shortfalls when `capacity` cannot give that.
 */
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

/** A spec as it arrives from outside (untrusted): every key a positive safe integer, nothing else. */
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

/** The unit of a key, as the English messages write it. */
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

/** A value of a key in English, e.g. "4 GiB". */
export const environmentValueText = (key: BotEnvironmentSpecKey, value: number) => UNIT[key](value)

/** Why the Host refuses a spec change (English). */
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

/** Why a new bot's environment cannot be made on this Host (English). */
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

/** Why a connector needing `need` of `key` cannot be turned on (English). */
export function environmentShortfallText(
  connector: string,
  shortfall: { readonly key: BotEnvironmentSpecKey; readonly need: number },
): string {
  return `${connector} needs ${environmentValueText(shortfall.key, shortfall.need)} of ${NOUN[shortfall.key]} or more: raise it on the bot's VM page first`
}

/**
 * Whether the bot's environment runs with its stored spec:
 * - `unread`: a bot stored before specs, until its environment's is read;
 * - `applying`: being ensured with it (a running VM restarts), at `phase`;
 * - `applied`: it runs with it;
 * - `failed`: the latest ensure failed (retried with backoff).
 */
export type BotEnvironmentApplication =
  | { readonly state: "unread"; readonly reason: string }
  | { readonly state: "applying"; readonly phase?: EnvironmentPhase }
  | { readonly state: "applied" }
  | { readonly state: "failed"; readonly reason: string }

/** Whether the environment's capacity could be read. */
export type BotEnvironmentCapacityState =
  | { readonly status: "ready"; readonly capacity: BotEnvironmentCapacity }
  | { readonly status: "unavailable"; readonly reason: string }

/** A bot's VM page. */
export interface BotEnvironmentView {
  readonly botId: string
  /** Absent until a bot stored before specs had its environment's read. */
  readonly spec?: BotEnvironmentSpec
  readonly capacity: BotEnvironmentCapacityState
  /** What the bot's enabled connectors need. */
  readonly needs: readonly BotEnvironmentNeed[]
  readonly application: BotEnvironmentApplication
}

/** The `botEnvironment` Remote. */
export interface BotEnvironmentApi {
  /** The bot's VM page now, then after every change. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotEnvironmentView>
  /**
   * Store the bot's whole spec and apply it now (a running VM is stopped,
   * changed and started again).
   * @throws when a changed key is outside the capacity, shrinks a grow-only key, or goes below what an enabled connector needs.
   */
  configure(botId: string, spec: BotEnvironmentSpec): Promise<BotEnvironmentView>
}
