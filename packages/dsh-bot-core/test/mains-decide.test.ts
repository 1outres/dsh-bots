import { describe, expect, it } from "vitest"
import { decideMain, type MainDecisionInput } from "../src/host/mains/decide"
import { countCompactions, usagePercentOf } from "../src/host/mains/log"
import { dailyBoundaryAfter } from "../src/host/mains/timing"
import {
  DEFAULT_MAIN_ROTATION,
  effectiveMainRotation,
  type MainRotationSettings,
  validateMainRotationOverride,
  validateMainRotationSettings,
} from "../src/shared/mains"

const MINUTE = 60_000
const settings = (change: Partial<MainRotationSettings> = {}): MainRotationSettings => ({
  ...DEFAULT_MAIN_ROTATION,
  ...change,
})
const input = (change: Partial<MainDecisionInput> = {}): MainDecisionInput => ({
  now: 100 * MINUTE,
  trigger: "tick",
  settings: settings(),
  facts: { lastTurnAt: 80 * MINUTE, compactions: 0 },
  ...change,
})

describe("decideMain", () => {
  it("leaves an unused Main alone, whatever is due", () => {
    expect(
      decideMain(input({ facts: { compactions: 9, usagePercent: 99 }, dailyBoundary: 0 })),
    ).toEqual({ kind: "wait" })
    expect(decideMain(input({ trigger: "input", facts: { compactions: 0 } }))).toEqual({
      kind: "wait",
    })
  })

  it("waits until the conversation is paused", () => {
    expect(
      decideMain(input({ facts: { lastTurnAt: 95 * MINUTE, compactions: 9 }, dailyBoundary: 0 })),
    ).toEqual({
      kind: "wait",
      until: 105 * MINUTE,
    })
  })

  it("starts a new Main once the daily boundary after its first turn passed, else waits for it", () => {
    expect(decideMain(input({ dailyBoundary: 99 * MINUTE }))).toEqual({
      kind: "rotate",
      reason: "daily",
    })
    expect(decideMain(input({ dailyBoundary: 300 * MINUTE }))).toEqual({
      kind: "wait",
      until: 300 * MINUTE,
    })
    const off = settings({ daily: { enabled: false, time: "04:00" } })
    expect(decideMain(input({ settings: off, dailyBoundary: 99 * MINUTE }))).toEqual({
      kind: "wait",
    })
  })

  it("starts a new Main after the set number of compactions", () => {
    expect(decideMain(input({ facts: { lastTurnAt: 80 * MINUTE, compactions: 3 } }))).toEqual({
      kind: "rotate",
      reason: "compactions",
    })
    const off = settings({ compactions: { enabled: false, count: 3 } })
    expect(
      decideMain(input({ settings: off, facts: { lastTurnAt: 80 * MINUTE, compactions: 3 } })),
    ).toEqual({
      kind: "wait",
    })
  })

  it("compacts a full paused Main once per pause, or rotates when that compaction would reach the count", () => {
    const facts = { lastTurnAt: 80 * MINUTE, compactions: 0, usagePercent: 60 }
    expect(decideMain(input({ facts }))).toEqual({ kind: "compact" })
    expect(decideMain(input({ facts: { ...facts, idleCompactedFor: 80 * MINUTE } }))).toEqual({
      kind: "wait",
    })
    expect(decideMain(input({ facts: { ...facts, usagePercent: 40 } }))).toEqual({ kind: "wait" })
    expect(decideMain(input({ facts: { ...facts, usagePercent: undefined } }))).toEqual({
      kind: "wait",
    })
    expect(decideMain(input({ facts: { ...facts, compactions: 2 } }))).toEqual({
      kind: "rotate",
      reason: "compactions",
    })
    const counting = settings({ compactions: { enabled: false, count: 3 } })
    expect(decideMain(input({ settings: counting, facts: { ...facts, compactions: 2 } }))).toEqual({
      kind: "compact",
    })
  })

  it("rotates before an input after a long pause, and never compacts for one", () => {
    const facts = { lastTurnAt: 0, compactions: 0, usagePercent: 90 }
    expect(decideMain(input({ trigger: "input", now: 360 * MINUTE, facts }))).toEqual({
      kind: "rotate",
      reason: "long-idle",
    })
    expect(decideMain(input({ trigger: "input", now: 359 * MINUTE, facts }))).toEqual({
      kind: "wait",
    })
    const off = settings({ longIdle: { enabled: false, minutes: 360 } })
    expect(
      decideMain(input({ trigger: "input", now: 999 * MINUTE, settings: off, facts })),
    ).toEqual({
      kind: "wait",
    })
    expect(decideMain(input({ trigger: "tick", now: 999 * MINUTE, facts }))).toEqual({
      kind: "compact",
    })
  })
})

describe("countCompactions", () => {
  const bracket = (summary: boolean, error?: string) => [
    { type: "compaction/start", data: { turn: null } },
    ...(summary ? [{ type: "compaction/summary", data: {} }] : []),
    { type: "compaction/end", data: error === undefined ? { turn: null } : { turn: null, error } },
  ]
  it("counts brackets that summarized and ended without an error", () => {
    expect(
      countCompactions([
        { type: "turn/start", data: { turn: 1 } },
        ...bracket(true),
        ...bracket(false),
        ...bracket(true, "changed"),
        ...bracket(true),
        { type: "compaction/summary", data: {} },
        { type: "compaction/end", data: { turn: 2 } },
      ]),
    ).toBe(2)
  })
})

describe("usagePercentOf", () => {
  it("is the last prompt over the window, unknown without both", () => {
    expect(usagePercentOf({ pressureTokens: 50_000, contextWindow: 200_000 })).toBe(25)
    expect(usagePercentOf({ pressureTokens: 50_000 })).toBeUndefined()
    expect(usagePercentOf({ contextWindow: 0, pressureTokens: 1 })).toBeUndefined()
  })
})

describe("dailyBoundaryAfter", () => {
  it("is the next local time in the bot's zone", () => {
    const after = Date.parse("2026-11-24T12:00:00+09:00")
    expect(dailyBoundaryAfter("04:00", "Asia/Tokyo", after)).toBe(
      Date.parse("2026-11-25T04:00:00+09:00"),
    )
    expect(dailyBoundaryAfter("13:30", "Asia/Tokyo", after)).toBe(
      Date.parse("2026-11-24T13:30:00+09:00"),
    )
  })
  it("skips a local time that does not exist that day", () => {
    const after = Date.parse("2026-03-08T00:00:00-05:00")
    expect(dailyBoundaryAfter("02:30", "America/New_York", after)).toBe(
      Date.parse("2026-03-09T02:30:00-04:00"),
    )
  })
  it("refuses a time that is not HH:MM", () => {
    expect(() => dailyBoundaryAfter("4:00", "UTC", 0)).toThrow(/HH:MM/)
  })
})

describe("Main rotation settings", () => {
  it("validates complete settings and partial overrides, refusing unknown fields and bounds", () => {
    expect(validateMainRotationSettings(DEFAULT_MAIN_ROTATION)).toEqual(DEFAULT_MAIN_ROTATION)
    expect(() =>
      validateMainRotationSettings({ ...DEFAULT_MAIN_ROTATION, quietMinutes: 0 }),
    ).toThrow(/quietMinutes/)
    expect(() =>
      validateMainRotationSettings({ ...DEFAULT_MAIN_ROTATION, daily: { enabled: true } }),
    ).toThrow(/daily.time is missing/)
    expect(() => validateMainRotationSettings({ ...DEFAULT_MAIN_ROTATION, extra: 1 })).toThrow(
      /unknown/,
    )
    expect(validateMainRotationOverride({ daily: { time: "05:30" }, longIdle: {} })).toEqual({
      daily: { time: "05:30" },
    })
    expect(() => validateMainRotationOverride({ daily: { time: "25:00" } })).toThrow(/HH:MM/)
  })

  it("lays a bot's override over the defaults field by field", () => {
    expect(
      effectiveMainRotation(DEFAULT_MAIN_ROTATION, { quietMinutes: 3, daily: { enabled: false } }),
    ).toEqual({
      ...DEFAULT_MAIN_ROTATION,
      quietMinutes: 3,
      daily: { enabled: false, time: "04:00" },
    })
  })
})
