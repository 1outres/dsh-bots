import { describe, expect, it } from "vitest"
import { chooseNotice } from "../src/host/schedule/choice"
import type { RunTrigger } from "../src/host/schedule/domain"
import { failureNotice, type NoticeRun } from "../src/host/schedule/notice"
import type { RunOutcome } from "../src/host/schedule/runs"
import { NOW } from "./schedule-support"

const OUTCOMES: readonly RunOutcome["kind"][] = ["ran", "reported", "quiet", "nothing", "failed"]
const TRIGGERS: readonly RunTrigger[] = ["schedule", "manual"]

const expected: Record<RunTrigger, Record<RunOutcome["kind"], [unknown, unknown, unknown]>> = {
  schedule: {
    ran: [
      { kind: "outcome", recoveredFrom: 0 },
      { kind: "outcome", recoveredFrom: 1 },
      { kind: "outcome", recoveredFrom: 3 },
    ],
    reported: [
      { kind: "outcome", recoveredFrom: 0 },
      { kind: "outcome", recoveredFrom: 1 },
      { kind: "outcome", recoveredFrom: 3 },
    ],
    quiet: [
      { kind: "none" },
      { kind: "recovery", outcome: "quiet", recoveredFrom: 1 },
      { kind: "recovery", outcome: "quiet", recoveredFrom: 3 },
    ],
    nothing: [
      { kind: "none" },
      { kind: "recovery", outcome: "nothing", recoveredFrom: 1 },
      { kind: "recovery", outcome: "nothing", recoveredFrom: 3 },
    ],
    failed: [{ kind: "failure" }, { kind: "none" }, { kind: "none" }],
  },
  manual: {
    ran: [
      { kind: "outcome", recoveredFrom: 0 },
      { kind: "outcome", recoveredFrom: 1 },
      { kind: "outcome", recoveredFrom: 3 },
    ],
    reported: [
      { kind: "outcome", recoveredFrom: 0 },
      { kind: "outcome", recoveredFrom: 1 },
      { kind: "outcome", recoveredFrom: 3 },
    ],
    quiet: [
      { kind: "empty", outcome: "quiet" },
      { kind: "recovery", outcome: "quiet", recoveredFrom: 1 },
      { kind: "recovery", outcome: "quiet", recoveredFrom: 3 },
    ],
    nothing: [
      { kind: "empty", outcome: "nothing" },
      { kind: "recovery", outcome: "nothing", recoveredFrom: 1 },
      { kind: "recovery", outcome: "nothing", recoveredFrom: 3 },
    ],
    failed: [{ kind: "failure" }, { kind: "failure" }, { kind: "failure" }],
  },
}

describe("which notice a run's end sends", () => {
  for (const trigger of TRIGGERS) {
    for (const outcome of OUTCOMES) {
      it(`${trigger} run, ${outcome}, streak 0 / 1 / 3`, () => {
        const chosen = [0, 1, 3].map((previousStreak) =>
          chooseNotice({ trigger, outcome, previousStreak }),
        )
        expect(chosen).toEqual(expected[trigger][outcome])
      })
    }
  }
})

describe("failure notice", () => {
  const run: NoticeRun = {
    jobId: "job-1",
    name: "Digest",
    mode: "main",
    timezone: "UTC",
    trigger: "schedule",
    scheduledAt: NOW,
    ranAt: NOW,
  }
  const failure = { stage: "run", message: "boom" } as const
  const FURTHER = "Further failures of this schedule are not told until a run succeeds again."

  it("says further failures are not told while the job has a next run", () => {
    expect(failureNotice(run, failure, { hasNextRun: true }).text).toContain(FURTHER)
  })

  it("leaves that out when the job has no next run", () => {
    const text = failureNotice(run, failure, { hasNextRun: false }).text
    expect(text).not.toContain("Further failures")
    expect(text).toContain("Its run failed: boom")
  })
})
