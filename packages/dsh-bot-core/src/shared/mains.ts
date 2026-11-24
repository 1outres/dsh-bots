/** When a bot's Main session is compacted while it is idle, and when a new Main takes its place. */

/** Why a Main session was replaced by a new one. */
export const MAIN_ROTATION_REASONS = ["daily", "long-idle", "compactions", "owner"] as const

export type MainRotationReason = (typeof MAIN_ROTATION_REASONS)[number]

export interface MainRotationSettings {
  /** Minutes without a turn after which the conversation counts as paused. */
  readonly quietMinutes: number
  /** Compact a paused Main whose context is at least this full. */
  readonly idleCompaction: { readonly enabled: boolean; readonly minUsagePercent: number }
  /** Start a new Main once a day at this local time ("HH:MM", the bot's time zone), when paused. */
  readonly daily: { readonly enabled: boolean; readonly time: string }
  /** Start a new Main before the first input after this many minutes without a turn. */
  readonly longIdle: { readonly enabled: boolean; readonly minutes: number }
  /** Start a new Main once this many compactions happened in it, when paused. */
  readonly compactions: { readonly enabled: boolean; readonly count: number }
  /** Before every compaction and new Main, the Main writes what it still needs into its notes. */
  readonly memoryFlush: { readonly enabled: boolean }
}

/** A bot's own values; an absent field follows the dsh-bots defaults. */
export interface MainRotationOverride {
  readonly quietMinutes?: number
  readonly idleCompaction?: Partial<MainRotationSettings["idleCompaction"]>
  readonly daily?: Partial<MainRotationSettings["daily"]>
  readonly longIdle?: Partial<MainRotationSettings["longIdle"]>
  readonly compactions?: Partial<MainRotationSettings["compactions"]>
  readonly memoryFlush?: Partial<MainRotationSettings["memoryFlush"]>
}

export const DEFAULT_MAIN_ROTATION: MainRotationSettings = {
  quietMinutes: 10,
  idleCompaction: { enabled: true, minUsagePercent: 50 },
  daily: { enabled: true, time: "04:00" },
  longIdle: { enabled: true, minutes: 360 },
  compactions: { enabled: true, count: 3 },
  memoryFlush: { enabled: true },
}

/** Inclusive bounds of each number. */
export const MAIN_ROTATION_BOUNDS = {
  quietMinutes: { min: 1, max: 1440 },
  minUsagePercent: { min: 1, max: 100 },
  longIdleMinutes: { min: 1, max: 43_200 },
  compactionCount: { min: 1, max: 100 },
} as const

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The hour and minute of a daily time ("04:00"). @throws when it is not HH:MM. */
export function parseDailyTime(time: string): { readonly hour: number; readonly minute: number } {
  const match = TIME.exec(time)
  if (match === null)
    throw new Error(`daily time ${JSON.stringify(time)} must be HH:MM (00:00–23:59)`)
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key))
  if (unknown !== undefined) throw new Error(`${what} has an unknown field "${unknown}"`)
}

function integer(
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
  what: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${what} must be an integer`)
  }
  if (value < bounds.min || value > bounds.max) {
    throw new Error(`${what} must be from ${bounds.min} to ${bounds.max}`)
  }
  return value
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${what} must be true or false`)
  return value
}

function dailyTime(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string`)
  parseDailyTime(value)
  return value
}

type Fields<T> = { readonly [K in keyof T]: (value: unknown, what: string) => T[K] }

const SECTIONS: {
  readonly [K in Exclude<keyof MainRotationSettings, "quietMinutes">]: Fields<
    MainRotationSettings[K]
  >
} = {
  idleCompaction: {
    enabled: flag,
    minUsagePercent: (value, what) => integer(value, MAIN_ROTATION_BOUNDS.minUsagePercent, what),
  },
  daily: { enabled: flag, time: dailyTime },
  longIdle: {
    enabled: flag,
    minutes: (value, what) => integer(value, MAIN_ROTATION_BOUNDS.longIdleMinutes, what),
  },
  compactions: {
    enabled: flag,
    count: (value, what) => integer(value, MAIN_ROTATION_BOUNDS.compactionCount, what),
  },
  memoryFlush: { enabled: flag },
}

const SECTION_KEYS = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]

function section<K extends keyof typeof SECTIONS>(
  key: K,
  value: unknown,
  partial: boolean,
): Partial<MainRotationSettings[K]> {
  const fields = SECTIONS[key] as Record<string, (value: unknown, what: string) => unknown>
  const given = record(value, key)
  onlyKeys(given, Object.keys(fields), key)
  const out: Record<string, unknown> = {}
  for (const [name, check] of Object.entries(fields)) {
    if (given[name] === undefined) {
      if (partial) continue
      throw new Error(`${key}.${name} is missing`)
    }
    out[name] = check(given[name], `${key}.${name}`)
  }
  return out as Partial<MainRotationSettings[K]>
}

/** Complete settings (untrusted input), checked. @throws naming the first problem. */
export function validateMainRotationSettings(input: unknown): MainRotationSettings {
  const value = record(input, "the settings")
  onlyKeys(value, ["quietMinutes", ...SECTION_KEYS], "the settings")
  return {
    quietMinutes: integer(value.quietMinutes, MAIN_ROTATION_BOUNDS.quietMinutes, "quietMinutes"),
    idleCompaction: section("idleCompaction", value.idleCompaction, false),
    daily: section("daily", value.daily, false),
    longIdle: section("longIdle", value.longIdle, false),
    compactions: section("compactions", value.compactions, false),
    memoryFlush: section("memoryFlush", value.memoryFlush, false),
  } as MainRotationSettings
}

/** A bot's override (untrusted input), checked; empty sections are dropped. @throws naming the first problem. */
export function validateMainRotationOverride(input: unknown): MainRotationOverride {
  const value = record(input, "the override")
  onlyKeys(value, ["quietMinutes", ...SECTION_KEYS], "the override")
  const out: Record<string, unknown> = {}
  if (value.quietMinutes !== undefined) {
    out.quietMinutes = integer(
      value.quietMinutes,
      MAIN_ROTATION_BOUNDS.quietMinutes,
      "quietMinutes",
    )
  }
  for (const key of SECTION_KEYS) {
    if (value[key] === undefined) continue
    const checked = section(key, value[key], true)
    if (Object.keys(checked).length > 0) out[key] = checked
  }
  return out as MainRotationOverride
}

/** The settings a bot runs with: the defaults with its override laid over them field by field. */
export function effectiveMainRotation(
  defaults: MainRotationSettings,
  override: MainRotationOverride,
): MainRotationSettings {
  return {
    quietMinutes: override.quietMinutes ?? defaults.quietMinutes,
    idleCompaction: { ...defaults.idleCompaction, ...override.idleCompaction },
    daily: { ...defaults.daily, ...override.daily },
    longIdle: { ...defaults.longIdle, ...override.longIdle },
    compactions: { ...defaults.compactions, ...override.compactions },
    memoryFlush: { ...defaults.memoryFlush, ...override.memoryFlush },
  }
}

/** What is being done to the bot's Main right now. */
export type MainMaintenanceState = "idle" | "compacting" | "rotating"

/** The bot's current Main as the settings show it. */
export interface BotMainStatus {
  readonly sessionId: string
  /** When it became the Main. */
  readonly startedAt: number
  /** When its last turn ended; absent while it has had none. */
  readonly lastTurnAt?: number
  /** Successful compactions in its log (automatic and idle). */
  readonly compactions: number
  readonly maintenance: MainMaintenanceState
}

/** One bot's Main settings and state, as `botMains.watch` streams them. */
export interface BotMainsView {
  readonly botId: string
  readonly defaults: MainRotationSettings
  readonly override: MainRotationOverride
  readonly effective: MainRotationSettings
  readonly status: BotMainStatus
}

/** What starting a new Main came to. */
export type MainRotationOutcome =
  | { readonly outcome: "started"; readonly sessionId: string }
  /** The Main has had no turn yet: it already is a new one. */
  | { readonly outcome: "unchanged" }
  | {
      readonly outcome: "refused"
      readonly reason: MainRotationRefusal
      /** English, for the person who asked. */
      readonly message: string
    }

export const MAIN_ROTATION_REFUSALS = ["busy", "preparation-failed", "not-ready", "failed"] as const

export type MainRotationRefusal = (typeof MAIN_ROTATION_REFUSALS)[number]

/** The `botMains` Remote. */
export interface BotMainsApi {
  /** The dsh-bots defaults now, then after every change. */
  watchDefaults(signal?: AbortSignal): AsyncIterable<MainRotationSettings>
  /** @throws when the settings are invalid. */
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  /** The bot's view now, then after every change. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotMainsView>
  /** Replace the bot's override (`{}` follows the defaults everywhere). @throws for an unknown bot or an invalid override. */
  configure(botId: string, override: MainRotationOverride): Promise<BotMainsView>
  /** The owner starts a new Main now; refused unless the Main is idle. */
  startNew(botId: string): Promise<MainRotationOutcome>
}
