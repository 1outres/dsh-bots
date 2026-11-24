import { describe, expect, it } from "vitest"
import { settle } from "./connectors-support"
import { exited, job, MINUTE, NOW, scheduleSetup, turnEnd } from "./schedule-support"

async function stored(setup: ReturnType<typeof scheduleSetup>, overrides = {}) {
  return setup.store.putJob("job-1", job(overrides))
}

describe("schedule runner", () => {
  it("main: hands the instruction and the check's output to the Main session", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "ls new", timeoutSeconds: 60 } })
    setup.checks.push(exited(0, "a.txt\nb.txt"))
    const run = await setup.runner.start(target, "schedule", NOW - 2 * MINUTE)
    expect(run.state).toBe("ran")
    expect(setup.notices).toHaveLength(1)
    const text = setup.notices[0]?.text ?? ""
    expect(text).toContain('[schedule] "Digest" (job-1) — scheduled 2026-11-23T09:58:00+00:00')
    expect(text).toContain("late by 2m")
    expect(text).toContain("kind: run")
    expect(text).toContain("Summarize the inbox.")
    expect(text).toContain("check output:\na.txt\nb.txt")
    expect(text).toContain("stay_silent")
  })

  it("a check that exits 1 ends the run quietly, without the model", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "false", timeoutSeconds: 60 } })
    setup.checks.push(exited(1))
    expect((await setup.runner.start(target, "schedule", NOW)).state).toBe("quiet")
    expect(setup.notices).toEqual([])
  })

  it("tells only the first failure of a streak, and the run that recovers", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "probe", timeoutSeconds: 60 } })
    setup.checks.push(exited(2, "", "boom"), { kind: "timed-out", stderr: "" }, exited(1))
    const first = await setup.runner.start(target, "schedule", NOW)
    expect(first).toMatchObject({ state: "failed", failure: { stage: "check", exitCode: 2 } })
    await setup.runner.start(target, "schedule", NOW)
    expect(setup.store.job("job-1")?.failureStreak).toBe(2)
    expect(setup.notices.map((notice) => notice.summary)).toEqual(['Schedule "Digest": failed'])
    expect(setup.notices[0]?.text).toContain("exit code: 2")
    expect(setup.notices[0]?.text).toContain("boom")
    await setup.runner.start(target, "schedule", NOW)
    expect(setup.store.job("job-1")?.failureStreak).toBe(0)
    expect(setup.notices[1]?.text).toContain("kind: recovery")
    expect(setup.notices[1]?.text).toContain("after 2 failed run(s)")
  })

  it("a check that cannot run fails the run", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "x", timeoutSeconds: 60 } })
    setup.state.checkThrows = true
    const run = await setup.runner.start(target, "schedule", NOW)
    expect(run.failure?.message).toContain("not ready")
  })

  it("skips a run while the job's previous one runs", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { mode: "separate" })
    const first = setup.runner.start(target, "schedule", NOW)
    await settle()
    expect(setup.runner.isRunning("job-1")).toBe(true)
    expect((await setup.runner.start(target, "schedule", NOW)).state).toBe("skipped")
    setup.runner.result("sep-1", { outcome: "nothing" })
    setup.runner.sessionEvent("sep-1", turnEnd({ kind: "completed" }))
    expect((await first).state).toBe("nothing")
    expect(setup.notices).toEqual([])
    expect(setup.archived).toEqual(["sep-1"])
  })

  it("separate: a report reaches the Main session; the session is archived", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { mode: "separate" })
    const done = setup.runner.start(target, "manual", NOW)
    await settle()
    expect(setup.prompts[0]?.sessionId).toBe("sep-1")
    expect(setup.prompts[0]?.text).toContain("schedule_result")
    expect(setup.runner.runOfSession("sep-1")).toMatchObject({ jobId: "job-1", sessionId: "sep-1" })
    setup.runner.result("sep-1", { outcome: "report", report: "3 new mails" })
    expect(() => setup.runner.result("sep-1", { outcome: "nothing" })).toThrow(/already/)
    setup.runner.sessionEvent("sep-1", turnEnd({ kind: "completed" }))
    const run = await done
    expect(run.state).toBe("reported")
    expect(setup.notices[0]?.text).toContain("run on request")
    expect(setup.notices[0]?.text).toContain(
      "kind: result\nA separate run of this schedule reported:\n3 new mails",
    )
    expect(setup.runner.runOfSession("sep-1")).toBeUndefined()
    expect(setup.archived).toEqual(["sep-1"])
  })

  it("separate: a turn without schedule_result, a failed turn or the time limit fail the run", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { mode: "separate" })
    const silent = setup.runner.start(target, "schedule", NOW)
    await settle()
    setup.runner.sessionEvent("sep-1", turnEnd({ kind: "completed" }))
    expect((await silent).failure?.message).toContain("without calling schedule_result")
    const broken = setup.runner.start(target, "schedule", NOW)
    await settle()
    setup.runner.sessionEvent("sep-2", turnEnd({ kind: "error", error: { message: "quota" } }))
    expect((await broken).failure?.message).toContain("quota")
    const slow = setup.runner.start(target, "schedule", NOW)
    await setup.clock.advance(61 * MINUTE)
    expect((await slow).failure?.message).toContain("did not finish within 60 minutes")
    expect(setup.archived).toEqual(["sep-1", "sep-2", "sep-3"])
    expect(setup.notices).toHaveLength(1)
  })

  it("separate: a session that cannot start fails the run", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { mode: "separate" })
    setup.state.openFails = true
    const run = await setup.runner.start(target, "schedule", NOW)
    expect(run.failure?.message).toContain("could not start: preset not ready")
    expect(() => setup.runner.result("sep-1", { outcome: "nothing" })).toThrow(/no scheduled run/)
  })

  it("fails the runs a restart interrupted and archives their sessions", async () => {
    const setup = scheduleSetup()
    await stored(setup)
    await setup.store.putRun("run-old", {
      botId: "b1",
      jobId: "job-1",
      trigger: "schedule",
      scheduledAt: NOW,
      startedAt: NOW,
      state: "running",
      sessionId: "sep-old",
    })
    await setup.runner.recover()
    expect(setup.store.run("run-old")).toMatchObject({
      state: "failed",
      failure: { message: "the Host stopped while this run was in progress" },
    })
    expect(setup.archived).toEqual(["sep-old"])
    expect(setup.notices[0]?.summary).toBe('Schedule "Digest": failed')
  })

  it("keeps the latest runs of a job, and none of a deleted job", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup)
    for (let index = 0; index < 5; index += 1) {
      await setup.runner.start(target, "schedule", NOW)
      await setup.clock.advance(MINUTE)
    }
    expect(setup.store.runs("job-1")).toHaveLength(3)
    await setup.store.deleteJob("job-1")
    expect(setup.runs.rows.size).toBe(0)
    await setup.runner.start(target, "schedule", NOW)
    expect(setup.runs.rows.size).toBe(0)
  })
})

describe("scheduler", () => {
  it("runs a due job once for its latest missed occurrence, then waits for the next", async () => {
    const setup = scheduleSetup()
    await setup.store.putJob("job-1", job({ nextRunAt: NOW - 150 * MINUTE }))
    setup.scheduler.sync()
    await settle()
    expect(setup.started).toEqual([{ jobId: "job-1", scheduledAt: NOW - 30 * MINUTE }])
    expect(setup.store.job("job-1")?.nextRunAt).toBe(NOW + 30 * MINUTE)
    await setup.clock.advance(30 * MINUTE)
    expect(setup.started).toHaveLength(2)
    expect(setup.notices).toHaveLength(2)
  })

  it("runs an expired at once, and never a disabled job", async () => {
    const setup = scheduleSetup()
    await setup.store.putJob(
      "job-1",
      job({ schedule: { kind: "at", at: NOW - 5 * MINUTE }, nextRunAt: NOW - 5 * MINUTE }),
    )
    await setup.store.putJob("job-2", job({ enabled: false, nextRunAt: NOW - MINUTE }))
    setup.scheduler.sync()
    await setup.clock.advance(24 * 60 * MINUTE)
    expect(setup.started).toEqual([{ jobId: "job-1", scheduledAt: NOW - 5 * MINUTE }])
    expect(setup.store.job("job-1")?.nextRunAt).toBeUndefined()
    expect(setup.notices[0]?.text).toContain("late by 5m")
  })

  it("stops a job whose next run cannot be computed", async () => {
    const setup = scheduleSetup()
    await setup.store.putJob(
      "job-1",
      job({ schedule: { kind: "cron", expression: "bad" }, nextRunAt: NOW - MINUTE }),
    )
    setup.scheduler.sync()
    await settle()
    expect(setup.started).toEqual([])
    expect(setup.store.job("job-1")?.nextRunAt).toBeUndefined()
    expect(setup.warnings[0]).toContain("stopped")
  })
})

describe("schedule runner: manual runs always answer", () => {
  it("a manual quiet check tells the Main session briefly", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "false", timeoutSeconds: 60 } })
    setup.checks.push(exited(1))
    expect((await setup.runner.start(target, "manual", NOW)).state).toBe("quiet")
    expect(setup.notices).toHaveLength(1)
    expect(setup.notices[0]?.text.split("\n")).toEqual([
      '[schedule] "Digest" (job-1) — run on request, ran 2026-11-23T10:00:00+00:00',
      "kind: quiet — the check found nothing to do",
    ])
  })

  it("a manual separate run with nothing to report tells the Main session briefly", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { mode: "separate" })
    const done = setup.runner.start(target, "manual", NOW)
    await settle()
    setup.runner.result("sep-1", { outcome: "nothing" })
    setup.runner.sessionEvent("sep-1", turnEnd({ kind: "completed" }))
    expect((await done).state).toBe("nothing")
    expect(setup.notices[0]?.text).toContain("kind: nothing — the run found nothing worth telling")
    expect(setup.notices[0]?.summary).toBe('Schedule "Digest": nothing')
  })

  it("a manual failure inside a streak is told; the streak still counts it", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, {
      check: { command: "probe", timeoutSeconds: 60 },
      failureStreak: 2,
    })
    setup.checks.push(exited(2, "", "boom"), exited(2, "", "boom"))
    await setup.runner.start(target, "schedule", NOW)
    expect(setup.notices).toEqual([])
    await setup.runner.start(target, "manual", NOW)
    expect(setup.store.job("job-1")?.failureStreak).toBe(4)
    expect(setup.notices.map((notice) => notice.summary)).toEqual(['Schedule "Digest": failed'])
    expect(setup.notices[0]?.text).toContain("run on request")
  })

  it("a manual run that ends a streak sends the recovery notice", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, {
      check: { command: "probe", timeoutSeconds: 60 },
      failureStreak: 1,
    })
    setup.checks.push(exited(1))
    await setup.runner.start(target, "manual", NOW)
    expect(setup.notices[0]?.text).toContain("kind: recovery")
    expect(setup.store.job("job-1")?.failureStreak).toBe(0)
  })
})

describe("schedule runner: the failure notice's streak line", () => {
  const FURTHER = "Further failures of this schedule are not told"

  it("is there for an armed recurring job", async () => {
    const setup = scheduleSetup()
    const target = await stored(setup, { check: { command: "probe", timeoutSeconds: 60 } })
    setup.checks.push(exited(2))
    await setup.runner.start(target, "schedule", NOW)
    expect(setup.notices[0]?.text).toContain(FURTHER)
  })

  it("is left out for a one-shot job and a disabled one", async () => {
    const setup = scheduleSetup()
    const { nextRunAt: _next, ...ended } = job({
      schedule: { kind: "at", at: NOW },
      check: { command: "probe", timeoutSeconds: 60 },
    })
    const once = await setup.store.putJob("job-1", ended)
    const disabled = await setup.store.putJob(
      "job-2",
      job({ enabled: false, check: { command: "probe", timeoutSeconds: 60 } }),
    )
    setup.checks.push(exited(2), exited(2))
    await setup.runner.start(once, "schedule", NOW)
    await setup.runner.start(disabled, "manual", NOW)
    expect(setup.notices).toHaveLength(2)
    for (const notice of setup.notices) {
      expect(notice.text).toContain("kind: failure")
      expect(notice.text).not.toContain(FURTHER)
    }
  })
})
