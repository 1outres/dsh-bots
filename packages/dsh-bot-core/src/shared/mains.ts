export const MAIN_ROTATION_REASONS = ["daily", "long-idle", "compactions", "owner"] as const

export type MainRotationReason = (typeof MAIN_ROTATION_REASONS)[number]

export interface MainRotationSettings {
  readonly quietMinutes: number
  readonly idleCompaction: { readonly enabled: boolean; readonly minUsagePercent: number }
  readonly daily: { readonly enabled: boolean; readonly time: string }
  readonly longIdle: { readonly enabled: boolean; readonly minutes: number }
  readonly compactions: { readonly enabled: boolean; readonly count: number }
  readonly memoryFlush: { readonly enabled: boolean }
}

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

export const MAIN_ROTATION_BOUNDS = {
  quietMinutes: { min: 1, max: 1440 },
  minUsagePercent: { min: 1, max: 100 },
  longIdleMinutes: { min: 1, max: 43_200 },
  compactionCount: { min: 1, max: 100 },
} as const

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

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

export type MainMaintenanceState = "idle" | "compacting" | "rotating"

export interface BotMainStatus {
  readonly sessionId: string
  readonly startedAt: number
  readonly lastTurnAt?: number
  readonly compactions: number
  readonly maintenance: MainMaintenanceState
}

export interface BotMainsView {
  readonly botId: string
  readonly defaults: MainRotationSettings
  readonly override: MainRotationOverride
  readonly effective: MainRotationSettings
  readonly status: BotMainStatus
}

export type MainRotationOutcome =
  | { readonly outcome: "started"; readonly sessionId: string }
  | { readonly outcome: "unchanged" }
  | {
      readonly outcome: "refused"
      readonly reason: MainRotationRefusal
      readonly message: string
    }

export const MAIN_ROTATION_REFUSALS = ["busy", "preparation-failed", "not-ready", "failed"] as const

export type MainRotationRefusal = (typeof MAIN_ROTATION_REFUSALS)[number]

export interface BotMainsApi {
  watchDefaults(signal?: AbortSignal): AsyncIterable<MainRotationSettings>
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotMainsView>
  configure(botId: string, override: MainRotationOverride): Promise<BotMainsView>
  startNew(botId: string): Promise<MainRotationOutcome>
}
