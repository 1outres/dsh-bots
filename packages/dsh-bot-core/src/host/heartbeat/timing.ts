import { parseLocalCalendar, resolveLocalInstant } from "@deepseek-ai/dsh-util-time"
import {
  type HeartbeatActiveHours,
  type HeartbeatSettings,
  minuteOfDay,
} from "../../shared/heartbeat"

const DAY_MINUTES = 1440

interface LocalDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function localParts(at: number, timezone: string): LocalDate & { readonly minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value)
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    minute: part("hour") * 60 + part("minute"),
  }
}

const two = (value: number) => String(value).padStart(2, "0")

function localInstant(date: LocalDate, minutes: number, timezone: string): number | undefined {
  const wall = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, minutes))
  const local = parseLocalCalendar(
    `${wall.getUTCFullYear()}-${two(wall.getUTCMonth() + 1)}-${two(wall.getUTCDate())}`,
    `${two(wall.getUTCHours())}:${two(wall.getUTCMinutes())}:00`,
  )
  if (local.kind === "rejected") throw new Error(local.reason)
  return resolveLocalInstant(local.time, timezone)
}

function shifted(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

function windowOf(hours: HeartbeatActiveHours | undefined): {
  readonly start: number
  readonly length: number
} {
  if (hours === undefined) return { start: 0, length: DAY_MINUTES }
  const start = minuteOfDay(hours.start)
  return { start, length: (minuteOfDay(hours.end) - start + DAY_MINUTES) % DAY_MINUTES }
}

export function withinActiveHours(
  hours: HeartbeatActiveHours | undefined,
  at: number,
  timezone: string,
): boolean {
  if (hours === undefined) return true
  const { start, length } = windowOf(hours)
  const minute = localParts(at, timezone).minute
  return (minute - start + DAY_MINUTES) % DAY_MINUTES < length
}

export function nextBeatAt(
  settings: HeartbeatSettings,
  timezone: string,
  after: number,
): number | undefined {
  if (!settings.enabled) return undefined
  const { start, length } = windowOf(settings.activeHours)
  const today = localParts(after, timezone)
  let best: number | undefined
  for (let offset = -1; offset <= 2; offset += 1) {
    const anchor = shifted(today, offset)
    for (let slot = 0; slot < length; slot += settings.intervalMinutes) {
      const at = localInstant(anchor, start + slot, timezone)
      if (at === undefined || at <= after) continue
      if (best === undefined || at < best) best = at
      break
    }
  }
  return best
}
