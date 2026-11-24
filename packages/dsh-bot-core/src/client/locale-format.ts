import type { MessageKey } from "./i18n"
import type { Translate } from "./types"

/** The dictionary entry naming the language its messages are written in, as a BCP 47 tag. */
export const FORMAT_LOCALE_KEY = "format.locale" satisfies MessageKey

/** A message worded per plural category: `<key>.one`, `<key>.other`, and any other category its languages use. */
export type PluralKey = {
  [Key in MessageKey]: Key extends `${infer Base}.other`
    ? `${Base}.one` extends MessageKey
      ? Base
      : never
    : never
}[MessageKey]

/** The reader's (the browser's) IANA time zone. */
export function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** `dateTime`: the day and the minute; `time`: the second, for instants within the day. */
export type InstantStyle = "dateTime" | "time"

/** `largestUnit`: the largest whole unit from minutes to days; `seconds`: always seconds, for countdowns. */
export type RelativeStyle = "largestUnit" | "seconds"

export interface RelativeParts {
  readonly value: number
  readonly unit: "second" | "minute" | "hour" | "day"
}

/**
 * Dates, times, relative times and counts in the language of the messages
 * around them, in the reader's (the browser's) time zone.
 */
export interface LocaleFormat {
  readonly locale: string
  instant(at: number, style: InstantStyle): string
  relative(at: number, now: number, style: RelativeStyle): string
  count(key: PluralKey, count: number, params?: CountParams): string
  number(value: number): string
  /** A calendar month, `YYYY-MM`, as its name and year ("November 2026", "2026年11月"). */
  month(month: string): string
  /** A calendar day, `YYYY-MM-DD`, in full ("Tuesday, November 24, 2026"). */
  day(date: string): string
  /** The short name of a weekday, 0 for Sunday. */
  weekday(index: number): string
}

/** Parameters of a plural message besides its `{count}`, which `count` fills in. */
export type CountParams = Readonly<Record<string, unknown>> & { readonly count?: never }

const INSTANT_OPTIONS: { readonly [Style in InstantStyle]: Intl.DateTimeFormatOptions } = {
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  time: { timeStyle: "medium" },
}

/** Calendar labels name a date, not an instant: they are formatted in UTC from the date's own fields. */
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

function formattersOf(locale: string): Formatters {
  const known = formatters.get(locale)
  if (known !== undefined) return known
  const created: Formatters = {
    instants: {
      dateTime: new Intl.DateTimeFormat(locale, INSTANT_OPTIONS.dateTime),
      time: new Intl.DateTimeFormat(locale, INSTANT_OPTIONS.time),
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

/** The UTC instant of a calendar date's midnight. */
function calendarInstant(value: string): number {
  const match = CALENDAR_DATE.exec(value)
  if (match === null) throw new Error(`not a calendar date: ${value}`)
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    match[3] === undefined ? 1 : Number(match[3]),
  )
}

/** 1970-01-04 was a Sunday. */
const SUNDAY_MS = Date.UTC(1970, 0, 4)
const DAY_MS = 86_400_000

/** How far `at` is from `now`, rounded away from now so that a moment left is never shown as none. */
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

/** The formats of the language `t` currently translates into. */
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
  }
}
