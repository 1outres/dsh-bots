import type { MessageKey } from "./i18n"
import type { Translate } from "./types"

export const FORMAT_LOCALE_KEY = "format.locale" satisfies MessageKey

export type PluralKey = {
  [Key in MessageKey]: Key extends `${infer Base}.other`
    ? `${Base}.one` extends MessageKey
      ? Base
      : never
    : never
}[MessageKey]

export function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

export type InstantStyle = "dateTime" | "time" | "clock"

export type RelativeStyle = "largestUnit" | "seconds"

export interface RelativeParts {
  readonly value: number
  readonly unit: "second" | "minute" | "hour" | "day"
}

export interface LocaleFormat {
  readonly locale: string
  instant(at: number, style: InstantStyle): string
  relative(at: number, now: number, style: RelativeStyle): string
  count(key: PluralKey, count: number, params?: CountParams): string
  number(value: number): string
  month(month: string): string
  day(date: string): string
  weekday(index: number): string
  dayOf(at: number): string
}

export type CountParams = Readonly<Record<string, unknown>> & { readonly count?: never }

const INSTANT_OPTIONS: { readonly [Style in InstantStyle]: Intl.DateTimeFormatOptions } = {
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  time: { timeStyle: "medium" },
  clock: { timeStyle: "short" },
}

const CALENDAR_OPTIONS = {
  month: { year: "numeric", month: "long", timeZone: "UTC" },
  day: { dateStyle: "full", timeZone: "UTC" },
  weekday: { weekday: "short", timeZone: "UTC" },
} as const satisfies Readonly<Record<string, Intl.DateTimeFormatOptions>>

interface Formatters {
  readonly instants: { readonly [Style in InstantStyle]: Intl.DateTimeFormat }
  readonly calendar: { readonly [Kind in keyof typeof CALENDAR_OPTIONS]: Intl.DateTimeFormat }
  readonly relative: Intl.RelativeTimeFormat
  readonly plural: Intl.PluralRules
  readonly number: Intl.NumberFormat
}

const formatters = new Map<string, Formatters>()

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function formattersOf(locale: string): Formatters {
  const known = formatters.get(locale)
  if (known !== undefined) return known
  const created: Formatters = {
    instants: {
      dateTime: new Intl.DateTimeFormat(locale, INSTANT_OPTIONS.dateTime),
      time: new Intl.DateTimeFormat(locale, INSTANT_OPTIONS.time),
      clock: new Intl.DateTimeFormat(locale, INSTANT_OPTIONS.clock),
    },
    calendar: {
      month: new Intl.DateTimeFormat(locale, CALENDAR_OPTIONS.month),
      day: new Intl.DateTimeFormat(locale, CALENDAR_OPTIONS.day),
      weekday: new Intl.DateTimeFormat(locale, CALENDAR_OPTIONS.weekday),
    },
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "always" }),
    plural: new Intl.PluralRules(locale),
    number: new Intl.NumberFormat(locale),
  }
  formatters.set(locale, created)
  return created
}

const MINUTE_MS = 60_000

const CALENDAR_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u

function calendarInstant(value: string): number {
  const match = CALENDAR_DATE.exec(value)
  if (match === null) throw new Error(`not a calendar date: ${value}`)
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    match[3] === undefined ? 1 : Number(match[3]),
  )
}

const SUNDAY_MS = Date.UTC(1970, 0, 4)
const DAY_MS = 86_400_000

export function relativeParts(at: number, now: number, style: RelativeStyle): RelativeParts {
  const ms = at - now
  const sign = ms < 0 ? -1 : 1
  const magnitude = Math.abs(ms)
  if (style === "seconds") return { value: sign * Math.ceil(magnitude / 1000), unit: "second" }
  const minutes = Math.ceil(magnitude / MINUTE_MS)
  if (minutes < 60) return { value: sign * minutes, unit: "minute" }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { value: sign * hours, unit: "hour" }
  return { value: sign * Math.floor(hours / 24), unit: "day" }
}

export function localeFormat(t: Translate): LocaleFormat {
  const locale = t(FORMAT_LOCALE_KEY)
  const intl = formattersOf(locale)
  return {
    locale,
    instant: (at, style) => intl.instants[style].format(at),
    relative: (at, now, style) => {
      const { value, unit } = relativeParts(at, now, style)
      return intl.relative.format(value, unit)
    },
    count: (key, count, params) =>
      t(`${key}.${intl.plural.select(count)}`, { count: intl.number.format(count), ...params }),
    number: (value) => intl.number.format(value),
    month: (month) => intl.calendar.month.format(calendarInstant(month)),
    day: (date) => intl.calendar.day.format(calendarInstant(date)),
    weekday: (index) => intl.calendar.weekday.format(SUNDAY_MS + index * DAY_MS),
    dayOf: (at) => DAY_PARTS.format(at),
  }
}
