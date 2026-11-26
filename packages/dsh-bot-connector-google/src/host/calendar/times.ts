import type { calendar_v3 } from "@googleapis/calendar"

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/
const OFFSET = /(Z|[+-]\d{2}:\d{2})$/

export function eventTime(
  value: string,
  timeZone: string | undefined,
  what: string,
): calendar_v3.Schema$EventDateTime {
  if (DATE.test(value)) return { date: value }
  if (!DATE_TIME.test(value))
    throw new Error(`${what} must be YYYY-MM-DD or an ISO 8601 date and time`)
  if (!OFFSET.test(value) && timeZone === undefined) {
    throw new Error(`${what} has no offset: add one (+09:00) or give time_zone`)
  }
  return { dateTime: value, ...(timeZone === undefined ? {} : { timeZone }) }
}

export function showTime(time: calendar_v3.Schema$EventDateTime | undefined): string {
  if (time === undefined) return ""
  if (time.date) return `${time.date} (all day)`
  return `${time.dateTime ?? ""}${time.timeZone ? ` ${time.timeZone}` : ""}`
}

export function instant(value: string | undefined, what: string): string | undefined {
  if (value === undefined) return undefined
  if (DATE.test(value)) return `${value}T00:00:00Z`
  if (!DATE_TIME.test(value) || !OFFSET.test(value))
    throw new Error(`${what} must be an ISO 8601 time with an offset`)
  return value
}
