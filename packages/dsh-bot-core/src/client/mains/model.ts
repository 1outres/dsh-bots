import {
  MAIN_ROTATION_BOUNDS,
  type MainRotationOverride,
  type MainRotationSettings,
} from "../../shared/mains"
import type { MessageKey } from "../i18n"

/** Every field of the Main settings, flattened from its section. */
export interface MainFieldValues {
  readonly quietMinutes: number
  readonly "idleCompaction.enabled": boolean
  readonly "idleCompaction.minUsagePercent": number
  readonly "daily.enabled": boolean
  readonly "daily.time": string
  readonly "longIdle.enabled": boolean
  readonly "longIdle.minutes": number
  readonly "compactions.enabled": boolean
  readonly "compactions.count": number
  readonly "memoryFlush.enabled": boolean
}

export type MainFieldId = keyof MainFieldValues

export type FieldsOf<V> = {
  readonly [Id in MainFieldId]: MainFieldValues[Id] extends V ? Id : never
}[MainFieldId]

export type MainField =
  | {
      readonly kind: "number"
      readonly id: FieldsOf<number>
      readonly label: MessageKey
      readonly bounds: { readonly min: number; readonly max: number }
    }
  | { readonly kind: "switch"; readonly id: FieldsOf<boolean>; readonly label: MessageKey }
  | { readonly kind: "time"; readonly id: FieldsOf<string>; readonly label: MessageKey }

/** The fields in the order the forms show them, each switch before its value. */
export const MAIN_FIELDS: readonly MainField[] = [
  {
    kind: "number",
    id: "quietMinutes",
    label: "mains.quietMinutes",
    bounds: MAIN_ROTATION_BOUNDS.quietMinutes,
  },
  { kind: "switch", id: "idleCompaction.enabled", label: "mains.idleCompaction" },
  {
    kind: "number",
    id: "idleCompaction.minUsagePercent",
    label: "mains.minUsagePercent",
    bounds: MAIN_ROTATION_BOUNDS.minUsagePercent,
  },
  { kind: "switch", id: "daily.enabled", label: "mains.daily" },
  { kind: "time", id: "daily.time", label: "mains.dailyTime" },
  { kind: "switch", id: "longIdle.enabled", label: "mains.longIdle" },
  {
    kind: "number",
    id: "longIdle.minutes",
    label: "mains.longIdleMinutes",
    bounds: MAIN_ROTATION_BOUNDS.longIdleMinutes,
  },
  { kind: "switch", id: "compactions.enabled", label: "mains.compactions" },
  {
    kind: "number",
    id: "compactions.count",
    label: "mains.compactionCount",
    bounds: MAIN_ROTATION_BOUNDS.compactionCount,
  },
  { kind: "switch", id: "memoryFlush.enabled", label: "mains.memoryFlush" },
]

/** Every field's value in the settings. */
export function fieldValues(settings: MainRotationSettings): MainFieldValues {
  return {
    quietMinutes: settings.quietMinutes,
    "idleCompaction.enabled": settings.idleCompaction.enabled,
    "idleCompaction.minUsagePercent": settings.idleCompaction.minUsagePercent,
    "daily.enabled": settings.daily.enabled,
    "daily.time": settings.daily.time,
    "longIdle.enabled": settings.longIdle.enabled,
    "longIdle.minutes": settings.longIdle.minutes,
    "compactions.enabled": settings.compactions.enabled,
    "compactions.count": settings.compactions.count,
    "memoryFlush.enabled": settings.memoryFlush.enabled,
  }
}

/** Complete settings from every field's value (checked by the Host). */
export function settingsOf(values: MainFieldValues): MainRotationSettings {
  return {
    quietMinutes: values.quietMinutes,
    idleCompaction: {
      enabled: values["idleCompaction.enabled"],
      minUsagePercent: values["idleCompaction.minUsagePercent"],
    },
    daily: { enabled: values["daily.enabled"], time: values["daily.time"] },
    longIdle: { enabled: values["longIdle.enabled"], minutes: values["longIdle.minutes"] },
    compactions: { enabled: values["compactions.enabled"], count: values["compactions.count"] },
    memoryFlush: { enabled: values["memoryFlush.enabled"] },
  }
}

/** The fields an override sets. */
export function overriddenFields(override: MainRotationOverride): ReadonlySet<MainFieldId> {
  const set: { readonly [Id in MainFieldId]: boolean } = {
    quietMinutes: override.quietMinutes !== undefined,
    "idleCompaction.enabled": override.idleCompaction?.enabled !== undefined,
    "idleCompaction.minUsagePercent": override.idleCompaction?.minUsagePercent !== undefined,
    "daily.enabled": override.daily?.enabled !== undefined,
    "daily.time": override.daily?.time !== undefined,
    "longIdle.enabled": override.longIdle?.enabled !== undefined,
    "longIdle.minutes": override.longIdle?.minutes !== undefined,
    "compactions.enabled": override.compactions?.enabled !== undefined,
    "compactions.count": override.compactions?.count !== undefined,
    "memoryFlush.enabled": override.memoryFlush?.enabled !== undefined,
  }
  return new Set(MAIN_FIELDS.map((field) => field.id).filter((id) => set[id]))
}

function only<T extends object>(value: T): T | undefined {
  return Object.keys(value).length === 0 ? undefined : value
}

function pick<Id extends MainFieldId>(
  values: MainFieldValues,
  own: ReadonlySet<MainFieldId>,
  id: Id,
): MainFieldValues[Id] | undefined {
  return own.has(id) ? values[id] : undefined
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>
}

/** The override that sets exactly the `own` fields to their values. */
export function overrideOf(
  values: MainFieldValues,
  own: ReadonlySet<MainFieldId>,
): MainRotationOverride {
  const idleCompaction = only(
    defined({
      enabled: pick(values, own, "idleCompaction.enabled"),
      minUsagePercent: pick(values, own, "idleCompaction.minUsagePercent"),
    }),
  )
  const daily = only(
    defined({ enabled: pick(values, own, "daily.enabled"), time: pick(values, own, "daily.time") }),
  )
  const longIdle = only(
    defined({
      enabled: pick(values, own, "longIdle.enabled"),
      minutes: pick(values, own, "longIdle.minutes"),
    }),
  )
  const compactions = only(
    defined({
      enabled: pick(values, own, "compactions.enabled"),
      count: pick(values, own, "compactions.count"),
    }),
  )
  const memoryFlush = only(defined({ enabled: pick(values, own, "memoryFlush.enabled") }))
  const quietMinutes = pick(values, own, "quietMinutes")
  return {
    ...(quietMinutes === undefined ? {} : { quietMinutes }),
    ...(idleCompaction === undefined ? {} : { idleCompaction }),
    ...(daily === undefined ? {} : { daily }),
    ...(longIdle === undefined ? {} : { longIdle }),
    ...(compactions === undefined ? {} : { compactions }),
    ...(memoryFlush === undefined ? {} : { memoryFlush }),
  }
}

/** A typed number, or undefined while it is not an integer within `bounds`. */
export function parseBoundedInteger(
  text: string,
  bounds: { readonly min: number; readonly max: number },
): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return value < bounds.min || value > bounds.max ? undefined : value
}
