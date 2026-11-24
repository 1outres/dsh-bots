/**
 * The time a search keeps to (docs/specs/bot-session-search.md §3): after and
 * before are a date or a date-time; without an offset they are read in the
 * bot's time zone, and a date is the start of that day.
 */
import {
  parseLocalCalendar,
  parseOffsetInstant,
  resolveLocalInstant,
} from "@deepseek-ai/dsh-util-time"
import { ConversationToolError } from "./errors"

/** Messages at or after `from` and before `to` (epoch milliseconds). */
export interface Period {
  readonly from?: number
  readonly to?: number
}

const MOMENT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(:\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** The instant a bound names. */
export function parseMoment(field: string, text: string, timezone: string): number {
  const match = MOMENT.exec(text.trim())
  if (match === null) {
    throw new ConversationToolError(
      `${field}: ${JSON.stringify(text)} is neither a date such as "2026-11-20" nor a date-time such as "2026-11-20T09:00"`,
    )
  }
  const [, date, clock, seconds, offset] = match
  const time = `${clock ?? "00:00"}${seconds ?? ":00"}`
  if (offset !== undefined) {
    const parsed = parseOffsetInstant(`${date}T${time}${offset}`)
    if (parsed.kind === "rejected") {
      throw new ConversationToolError(
        `${field}: ${JSON.stringify(text)} is not a valid time (${parsed.reason})`,
      )
    }
    return parsed.epoch
  }
  const local = parseLocalCalendar(date as string, time)
  if (local.kind === "rejected") {
    throw new ConversationToolError(
      `${field}: ${JSON.stringify(text)} is not a valid time (${local.reason})`,
    )
  }
  const epoch = resolveLocalInstant(local.time, timezone)
  if (epoch === undefined) {
    throw new ConversationToolError(
      `${field}: ${JSON.stringify(text)} does not exist in ${timezone} (the clocks skip it); give a time with an offset`,
    )
  }
  return epoch
}

export function parsePeriod(
  bounds: { readonly after?: string; readonly before?: string },
  timezone: string,
): Period {
  const from = bounds.after === undefined ? undefined : parseMoment("after", bounds.after, timezone)
  const to =
    bounds.before === undefined ? undefined : parseMoment("before", bounds.before, timezone)
  if (from !== undefined && to !== undefined && from >= to) {
    throw new ConversationToolError("after must be earlier than before")
  }
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }
}

export const withinPeriod = (period: Period, time: number) =>
  (period.from === undefined || time >= period.from) &&
  (period.to === undefined || time < period.to)
