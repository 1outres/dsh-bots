import { parseDailyTime } from "./mains"

export interface HeartbeatActiveHours {
  readonly start: string
  readonly end: string
}

export interface HeartbeatSettings {
  readonly enabled: boolean
  readonly intervalMinutes: number
  readonly activeHours?: HeartbeatActiveHours
}

export const MIN_HEARTBEAT_MINUTES = 5
export const MAX_HEARTBEAT_MINUTES = 1440

export const DEFAULT_HEARTBEAT: HeartbeatSettings = { enabled: true, intervalMinutes: 180 }

export const HEARTBEAT_OUTCOMES = ["sent", "nothing", "outside-hours"] as const

export type HeartbeatOutcome = (typeof HEARTBEAT_OUTCOMES)[number]

export interface HeartbeatLastBeat {
  readonly at: number
  readonly outcome: HeartbeatOutcome
}

export interface HeartbeatStatus {
  readonly next?: number
  readonly pending: boolean
  readonly last?: HeartbeatLastBeat
}

export interface BotHeartbeatView {
  readonly botId: string
  readonly settings: HeartbeatSettings
  readonly status: HeartbeatStatus
}

export interface BotHeartbeatApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotHeartbeatView>
  configure(botId: string, settings: HeartbeatSettings): Promise<BotHeartbeatView>
}

export function minuteOfDay(time: string): number {
  const { hour, minute } = parseDailyTime(time)
  return hour * 60 + minute
}

export function activeHoursProblem(hours: HeartbeatActiveHours): string | undefined {
  try {
    if (minuteOfDay(hours.start) === minuteOfDay(hours.end)) {
      return "the active hours must start and end at different times"
    }
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function intervalProblem(minutes: unknown): string | undefined {
  return typeof minutes === "number" &&
    Number.isSafeInteger(minutes) &&
    minutes >= MIN_HEARTBEAT_MINUTES &&
    minutes <= MAX_HEARTBEAT_MINUTES
    ? undefined
    : `the heartbeat interval must be a whole number of minutes from ${MIN_HEARTBEAT_MINUTES} to ${MAX_HEARTBEAT_MINUTES}`
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

function activeHoursOf(value: unknown): HeartbeatActiveHours {
  const input = objectOf(value, "activeHours")
  const unknown = Object.keys(input).find((key) => key !== "start" && key !== "end")
  if (unknown !== undefined) throw new Error(`activeHours has no field "${unknown}"`)
  if (typeof input.start !== "string" || typeof input.end !== "string") {
    throw new Error("activeHours.start and activeHours.end must be HH:MM")
  }
  const hours = { start: input.start, end: input.end }
  const problem = activeHoursProblem(hours)
  if (problem !== undefined) throw new Error(problem)
  return hours
}

export function parseHeartbeatSettings(value: unknown): HeartbeatSettings {
  const input = objectOf(value, "the heartbeat settings")
  const unknown = Object.keys(input).find(
    (key) => key !== "enabled" && key !== "intervalMinutes" && key !== "activeHours",
  )
  if (unknown !== undefined) throw new Error(`the heartbeat settings have no field "${unknown}"`)
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be true or false")
  const problem = intervalProblem(input.intervalMinutes)
  if (problem !== undefined) throw new Error(problem)
  return {
    enabled: input.enabled,
    intervalMinutes: input.intervalMinutes as number,
    ...(input.activeHours === undefined ? {} : { activeHours: activeHoursOf(input.activeHours) }),
  }
}

const RANGE = /^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/

export function formatActiveHours(hours: HeartbeatActiveHours | undefined): string {
  return hours === undefined ? "" : `${hours.start}-${hours.end}`
}

export function parseActiveHours(text: string): HeartbeatActiveHours | undefined {
  if (text.trim() === "") return undefined
  const match = RANGE.exec(text)
  if (match === null) throw new Error(`${JSON.stringify(text)} is not HH:MM-HH:MM`)
  return activeHoursOf({ start: match[1], end: match[2] })
}
