import { describe, expect, it } from "vitest"
import {
  canonicalTimezone,
  cronMinimumGapMinutes,
  decideDue,
  describeSchedule,
  firstRun,
  formatLocal,
  formatSpan,
  parseAt,
  parseDelay,
  planSchedule,
  upcomingRuns,
} from "../src/host/schedule/timing"

const NOW = Date.parse("2026-11-23T10:00:00+00:00")
const MIN = 60_000

describe("schedule timing", () => {
  it("reads spans and zones", () => {
    expect(parseDelay("30m")).toBe(1800)
    expect(parseDelay("1h30m")).toBe(5400)
    expect(parseDelay("1d 2h")).toBe(93_600)
    expect(() => parseDelay("soon")).toThrow(/not a span/)
    expect(() => parseDelay("0m")).toThrow(/positive/)
    expect(canonicalTimezone("Asia/Tokyo")).toBe("Asia/Tokyo")
    expect(() => canonicalTimezone("JST")).toThrow(/not usable/)
  })

  it("reads an at with or without an offset, in the job's zone", () => {
    expect(parseAt("2026-11-24T09:00", "Asia/Tokyo")).toBe(Date.parse("2026-11-24T00:00:00Z"))
    expect(parseAt("2026-11-24T09:00:00+02:00", "Asia/Tokyo")).toBe(
      Date.parse("2026-11-24T07:00:00Z"),
    )
    expect(() => parseAt("2027-03-14T02:30", "America/New_York")).toThrow(/skip/)
    expect(() => parseAt("tomorrow", "UTC")).toThrow(/ISO 8601/)
  })

  it("plans schedules: after becomes an at, every and cron keep 5 minutes apart", () => {
    expect(planSchedule({ kind: "after", delay: "2h" }, "UTC", NOW)).toEqual({
      kind: "at",
      at: NOW + 120 * MIN,
    })
    expect(() => planSchedule({ kind: "at", at: "2026-11-23T09:00Z" }, "UTC", NOW)).toThrow(
      /future/,
    )
    expect(() => planSchedule({ kind: "every", interval: "4m" }, "UTC", NOW)).toThrow(/5 minutes/)
    expect(planSchedule({ kind: "every", interval: "5m" }, "UTC", NOW)).toEqual({
      kind: "every",
      everySeconds: 300,
    })
    expect(planSchedule({ kind: "cron", expr: "*/5 * * * *" }, "UTC", NOW)).toEqual({
      kind: "cron",
      expression: "*/5 * * * *",
    })
    expect(() => planSchedule({ kind: "cron", expr: "*/2 * * * *" }, "UTC", NOW)).toThrow(
      /less than 5 minutes/,
    )
    expect(() => planSchedule({ kind: "cron", expr: "0,58 9,10 * * *" }, "UTC", NOW)).toThrow(
      /less than 5 minutes/,
    )
    expect(() => planSchedule({ kind: "cron", expr: "0 9 * *" }, "UTC", NOW)).toThrow(/five/)
  })

  it("measures a cron's closest runs from its minute and hour fields", () => {
    expect(cronMinimumGapMinutes([0, 30], [9])).toBe(30)
    expect(cronMinimumGapMinutes([58], [9, 10])).toBe(60)
    expect(cronMinimumGapMinutes([0, 58], [23, 0])).toBe(2)
    expect(cronMinimumGapMinutes([0, 58], [9, 11])).toBe(58)
  })

  it("collapses missed runs into the latest one", () => {
    const every = { schedule: { kind: "every", everySeconds: 300 }, timezone: "UTC" } as const
    expect(firstRun(every, NOW)).toBe(NOW + 5 * MIN)
    expect(decideDue(every, NOW, NOW + 23 * MIN)).toEqual({
      occurrenceAt: NOW + 20 * MIN,
      next: NOW + 25 * MIN,
    })
    const cron = {
      schedule: { kind: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Tokyo",
    } as const
    const first = firstRun(cron, NOW) ?? 0
    expect(new Date(first).toISOString()).toBe("2026-11-24T00:00:00.000Z")
    expect(decideDue(cron, first, first + 3 * 86_400_000 + MIN)).toEqual({
      occurrenceAt: first + 3 * 86_400_000,
      next: first + 4 * 86_400_000,
    })
    const at = { schedule: { kind: "at", at: NOW - MIN }, timezone: "UTC" } as const
    expect(decideDue(at, NOW - MIN, NOW)).toEqual({ occurrenceAt: NOW - MIN })
  })

  it("lists upcoming runs and formats them in the job's zone", () => {
    const cron = {
      schedule: { kind: "cron", expression: "0 9 * * 1-5" },
      timezone: "Asia/Tokyo",
    } as const
    const runs = upcomingRuns(cron, firstRun(cron, NOW), 3).map((ms) =>
      formatLocal(ms, "Asia/Tokyo"),
    )
    expect(runs).toEqual([
      "2026-11-24T09:00:00+09:00",
      "2026-11-25T09:00:00+09:00",
      "2026-11-26T09:00:00+09:00",
    ])
    expect(formatLocal(NOW, "UTC")).toBe("2026-11-23T10:00:00+00:00")
    expect(upcomingRuns(cron, undefined, 3)).toEqual([])
    expect(formatSpan(2 * 3_600_000 + 5 * MIN)).toBe("2h 5m")
    expect(formatSpan(42_000)).toBe("42s")
    expect(
      describeSchedule({ schedule: { kind: "every", everySeconds: 5400 }, timezone: "UTC" }),
    ).toBe("every 1h 30m")
  })
})
