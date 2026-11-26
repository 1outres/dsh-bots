import type { CheckResult } from "../src/host/schedule/check"
import type { JobRecord, RunRecord } from "../src/host/schedule/domain"
import type { ScheduleNotice } from "../src/host/schedule/notice"
import { createScheduleRunner } from "../src/host/schedule/runner"
import { createScheduler } from "../src/host/schedule/scheduler"
import { createScheduleStore } from "../src/host/schedule/store"
import { memoryTable } from "./channels-support"
import { manualClock } from "./connectors-support"

export const NOW = Date.parse("2026-11-23T10:00:00Z")
export const MINUTE = 60_000

export function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    botId: "b1",
    name: "Digest",
    mode: "main",
    schedule: { kind: "every", everySeconds: 3600 },
    timezone: "UTC",
    instruction: "Summarize the inbox.",
    enabled: true,
    createdBy: { sessionId: "main-1" },
    createdAt: NOW,
    updatedAt: NOW,
    nextRunAt: NOW + 60 * MINUTE,
    failureStreak: 0,
    ...overrides,
  }
}

export function scheduleSetup() {
  const clock = manualClock(NOW)
  const jobs = memoryTable<JobRecord>()
  const runs = memoryTable<RunRecord>()
  const store = createScheduleStore({ jobs, runs, keepRuns: 3 })
  const notices: ScheduleNotice[] = []
  const prompts: { sessionId: string; text: string }[] = []
  const archived: string[] = []
  const warnings: string[] = []
  const checks: CheckResult[] = []
  const state = { sessions: 0, openFails: false, checkThrows: false }
  let ids = 0
  const runner = createScheduleRunner({
    store,
    async check() {
      if (state.checkThrows) throw new Error("the bot's environment is not ready")
      const next = checks.shift()
      if (next === undefined) throw new Error("no check result queued")
      return next
    },
    async notify(_botId, notice) {
      notices.push(notice)
    },
    async openSession() {
      if (state.openFails) throw new Error("preset not ready")
      state.sessions += 1
      return `sep-${state.sessions}`
    },
    async prompt(sessionId, prompt) {
      prompts.push({ sessionId, text: prompt.text })
    },
    async archive(sessionId) {
      archived.push(sessionId)
    },
    later: clock.later,
    separateLimitMs: 60 * MINUTE,
    now: clock.now,
    newId: () => `run-${++ids}`,
    warn: (message) => warnings.push(message),
  })
  const started: { jobId: string; scheduledAt: number }[] = []
  const scheduler = createScheduler({
    store,
    start(job, scheduledAt) {
      started.push({ jobId: job.id, scheduledAt })
      void runner.start(job, "schedule", scheduledAt)
    },
    now: clock.now,
    later: clock.later,
    maxDelayMs: 24 * 60 * MINUTE,
    warn: (message) => warnings.push(message),
  })
  return {
    clock,
    jobs,
    runs,
    store,
    runner,
    scheduler,
    notices,
    prompts,
    archived,
    warnings,
    checks,
    state,
    started,
  }
}

export const exited = (exitCode: number, stdout = "", stderr = ""): CheckResult => ({
  kind: "exited",
  exitCode,
  signal: null,
  stdout: { text: stdout, truncated: false },
  stderr,
})

export const turnEnd = (reason: unknown) => ({ type: "turn/end", data: { turn: 1, reason } })
