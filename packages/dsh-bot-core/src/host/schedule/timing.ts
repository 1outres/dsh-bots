/**
 * When a job runs. Every calendar computation goes to DSH's own schedule
 * libraries: `@deepseek-ai/dsh-schedule` (cron validation, fixed-rate
 * decisions) and `@deepseek-ai/dsh-util-time` (zones, instants, the parsed
 * cron rule and its occurrences). Pure: the caller passes `now`.
 */
import { parseCronInput, resolveEveryOccurrence } from "@deepseek-ai/dsh-schedule"
import {
  Cron,
  canonicalizeTimeZone,
  Duration,
  parseLocalCalendar,
  parseOffsetInstant,
  resolveLocalInstant,
} from "@deepseek-ai/dsh-util-time"
import type { StoredSchedule } from "./domain"

/** When a job runs, as the agent states it. */
export type ScheduleInput =
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "after"; readonly delay: string }
  | { readonly kind: "every"; readonly interval: string }
  | { readonly kind: "cron"; readonly expr: string }

/** A stored schedule with the zone it is read in. */
export interface Timing {
  readonly schedule: StoredSchedule
  readonly timezone: string
}

/** Closest two runs of one recurring job may be. */
export const MIN_INTERVAL_SECONDS = 5 * 60

/** A job field that cannot be used (a schedule, zone, span…); the message is for the agent. */
export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidScheduleError"
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

/** The canonical IANA name of a zone. */
export function canonicalTimezone(value: string): string {
  const result = canonicalizeTimeZone(value)
  if (result.kind === "rejected") {
    throw new InvalidScheduleError(
      `time zone ${JSON.stringify(value)} is not usable (${result.reason}); give an IANA name such as "Asia/Tokyo" or "UTC"`,
    )
  }
  return result.timeZone
}

const DELAY = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

/** Seconds of a span written as `1d2h30m15s` (any of the parts, in that order). */
export function parseDelay(text: string): number {
  const compact = text.replaceAll(/\s+/g, "")
  const match = compact === "" ? null : DELAY.exec(compact)
  if (match === null) {
    throw new InvalidScheduleError(
      `${JSON.stringify(text)} is not a span; write it like "30m", "2h", "1h30m" or "1d"`,
    )
  }
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  const total = (days ?? 0) * 86_400 + (hours ?? 0) * 3_600 + (minutes ?? 0) * 60 + (seconds ?? 0)
  if (total <= 0) throw new InvalidScheduleError(`${JSON.stringify(text)} is not a positive span`)
  return total
}

const AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/

/** The instant of an ISO 8601 date-time; one without an offset is local time in `timezone`. */
export function parseAt(text: string, timezone: string): number {
  const match = AT.exec(text.trim())
  if (match === null) {
    throw new InvalidScheduleError(
      `${JSON.stringify(text)} is not an ISO 8601 date-time such as "2026-05-01T09:00" or "2026-05-01T09:00:00+09:00"`,
    )
  }
  const [, date, clock, seconds, offset] = match
  const time = `${clock}${seconds ?? ":00"}`
  if (offset !== undefined) {
    const parsed = parseOffsetInstant(`${date}T${time}${offset}`)
    if (parsed.kind === "rejected") {
      throw new InvalidScheduleError(
        `${JSON.stringify(text)} is not a valid instant (${parsed.reason})`,
      )
    }
    return parsed.epoch
  }
  const local = parseLocalCalendar(date as string, time)
  if (local.kind === "rejected") {
    throw new InvalidScheduleError(
      `${JSON.stringify(text)} is not a valid date-time (${local.reason})`,
    )
  }
  const epoch = resolveLocalInstant(local.time, timezone)
  if (epoch === undefined) {
    throw new InvalidScheduleError(
      `${JSON.stringify(text)} does not exist in ${timezone} (the clocks skip it)`,
    )
  }
  return epoch
}

const cronOf = (expression: string, timezone: string): Cron => {
  const parsed = Cron.parse(expression, timezone)
  if (parsed.kind === "rejected") throw new InvalidScheduleError(parsed.detail)
  return parsed.rule
}

/**
 * The shortest gap between two runs the expression's minute and hour fields
 * allow, in minutes: two matched minutes of one hour, or the last minute of
 * a matched hour and the first of the next matched one (23 → 0 counts, the
 * next day may match). Clock changes (DST) are not considered.
 */
export function cronMinimumGapMinutes(
  minutes: readonly number[],
  hours: readonly number[],
): number {
  let gap = Number.POSITIVE_INFINITY
  for (let index = 1; index < minutes.length; index += 1) {
    gap = Math.min(gap, (minutes[index] ?? 0) - (minutes[index - 1] ?? 0))
  }
  const first = minutes[0]
  const last = minutes.at(-1)
  const matched = new Set(hours)
  const adjacent = hours.some((hour) => matched.has((hour + 1) % 24))
  if (first !== undefined && last !== undefined && adjacent) gap = Math.min(gap, 60 - last + first)
  return gap
}

/** The stored form of a schedule, checked; `after` becomes its `at`. */
export function planSchedule(input: ScheduleInput, timezone: string, now: number): StoredSchedule {
  switch (input.kind) {
    case "at": {
      const at = parseAt(input.at, timezone)
      if (at <= now) throw new InvalidScheduleError(`${input.at} is not in the future`)
      return { kind: "at", at }
    }
    case "after":
      return { kind: "at", at: now + parseDelay(input.delay) * 1000 }
    case "every": {
      const everySeconds = parseDelay(input.interval)
      if (everySeconds < MIN_INTERVAL_SECONDS) {
        throw new InvalidScheduleError(
          `an every schedule runs at most every ${MIN_INTERVAL_SECONDS / 60} minutes`,
        )
      }
      return { kind: "every", everySeconds }
    }
    case "cron": {
      let expression: string
      try {
        expression = parseCronInput({ expression: input.expr, time_zone: timezone }).expression
      } catch (error) {
        throw new InvalidScheduleError(error instanceof Error ? error.message : String(error))
      }
      const { minutes, hours } = cronOf(expression, timezone).fields
      if (cronMinimumGapMinutes(minutes, hours) * 60 < MIN_INTERVAL_SECONDS) {
        throw new InvalidScheduleError(
          `cron ${JSON.stringify(expression)} runs less than ${MIN_INTERVAL_SECONDS / 60} minutes apart`,
        )
      }
      return { kind: "cron", expression }
    }
  }
}

/** The first run of a schedule set at `now`; undefined when it has none. */
export function firstRun(timing: Timing, now: number): number | undefined {
  const { schedule } = timing
  switch (schedule.kind) {
    case "at":
      return schedule.at
    case "every":
      return now + schedule.everySeconds * 1000
    case "cron": {
      const next = cronOf(schedule.expression, timing.timezone).next(now)
      return next === undefined ? undefined : Date.parse(next)
    }
  }
}

/** A due job's run: its latest due occurrence (missed ones collapse into it) and the next one. */
export interface DueDecision {
  readonly occurrenceAt: number
  readonly next?: number
}

/** Decide a job due at `nextRunAt` (≤ `now`). */
export function decideDue(timing: Timing, nextRunAt: number, now: number): DueDecision {
  const { schedule } = timing
  const decided = (occurrence: { occurrenceAt: string; nextScheduledAt?: string }) => ({
    occurrenceAt: Date.parse(occurrence.occurrenceAt),
    ...(occurrence.nextScheduledAt === undefined
      ? {}
      : { next: Date.parse(occurrence.nextScheduledAt) }),
  })
  switch (schedule.kind) {
    case "at":
      return { occurrenceAt: nextRunAt }
    case "every":
      return decided(
        resolveEveryOccurrence(
          { everySeconds: schedule.everySeconds, scheduledAt: iso(nextRunAt) },
          now,
        ),
      )
    case "cron":
      return decided(cronOf(schedule.expression, timing.timezone).resolve(iso(nextRunAt), now))
  }
}

/** Up to `count` runs from `nextRunAt` on. */
export function upcomingRuns(
  timing: Timing,
  nextRunAt: number | undefined,
  count: number,
): number[] {
  if (nextRunAt === undefined) return []
  const { schedule } = timing
  switch (schedule.kind) {
    case "at":
      return [nextRunAt]
    case "every":
      return Array.from(
        { length: count },
        (_, index) => nextRunAt + index * schedule.everySeconds * 1000,
      )
    case "cron": {
      const cron = cronOf(schedule.expression, timing.timezone)
      const runs = [nextRunAt]
      while (runs.length < count) {
        const next = cron.next(runs.at(-1) ?? nextRunAt)
        if (next === undefined) break
        runs.push(Date.parse(next))
      }
      return runs
    }
  }
}

/** An instant as local ISO 8601 time with its offset, e.g. `2026-05-01T09:00:00+09:00`. */
export function formatLocal(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(ms)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  const zone = part("timeZoneName").replace("GMT", "")
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${zone === "" ? "Z" : zone}`
}

/** A span such as `1d 2h 5m` (seconds only under a minute). */
export function formatSpan(ms: number): string {
  const { days, hours, minutes, seconds } = Duration.fromMilliseconds(Math.max(0, ms)).decompose()
  const parts = [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
  ].filter((part) => part !== "")
  return parts.length > 0 ? parts.join(" ") : `${seconds}s`
}

/** A stored schedule as the agent reads it. */
export function describeSchedule(timing: Timing): string {
  const { schedule, timezone } = timing
  switch (schedule.kind) {
    case "at":
      return `at ${formatLocal(schedule.at, timezone)}`
    case "every":
      return `every ${formatSpan(schedule.everySeconds * 1000)}`
    case "cron":
      return `cron "${schedule.expression}" (${timezone})`
  }
}
