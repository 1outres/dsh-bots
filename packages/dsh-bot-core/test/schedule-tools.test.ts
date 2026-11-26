import type { Context } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import { createCheckRunner } from "../src/host/schedule/check"
import { changedJob, newJob } from "../src/host/schedule/jobs"
import { createScheduleTools, type ScheduleCaller } from "../src/host/schedule/tools"
import { CALL_SCHEDULE_TOOL, SCHEDULE_TOOL_AVAILABLE } from "../src/internal"
import BotScheduleTools, { MODE_RULE, SCHEDULE_DESCRIPTION } from "../src/plugins/schedule"
import { settle } from "./connectors-support"
import { job, MINUTE, NOW, scheduleSetup, turnEnd } from "./schedule-support"

describe("schedule jobs", () => {
  const context = { botId: "b1", sessionId: "main-1", botTimezone: "Asia/Tokyo", now: NOW }

  it("takes the bot's zone unless given one, and a check's default time limit", () => {
    const created = newJob(
      {
        name: "Morning",
        mode: "main",
        schedule: { kind: "cron", expr: "0 9 * * *" },
        instruction: "Say good morning.",
        check: { command: "test -f flag" },
      },
      context,
    )
    expect(created).toMatchObject({
      timezone: "Asia/Tokyo",
      check: { command: "test -f flag", timeoutSeconds: 60 },
      nextRunAt: Date.parse("2026-11-24T00:00:00Z"),
      failureStreak: 0,
      enabled: true,
    })
    const paris = newJob(
      {
        name: "x",
        mode: "separate",
        schedule: { kind: "at", at: "2026-11-24T09:00" },
        instruction: "y",
        timezone: "Europe/Paris",
      },
      context,
    )
    expect(paris.nextRunAt).toBe(Date.parse("2026-11-24T08:00:00Z"))
  })

  it("restarts a changed schedule from now, skips what passed while disabled, removes a check", () => {
    const base = job({ check: { command: "c", timeoutSeconds: 10 }, nextRunAt: NOW - 90 * MINUTE })
    expect(changedJob(base, { name: "Renamed" }, NOW).nextRunAt).toBe(NOW - 90 * MINUTE)
    expect(changedJob(base, { schedule: { kind: "every", interval: "10m" } }, NOW).nextRunAt).toBe(
      NOW + 10 * MINUTE,
    )
    const paused = changedJob(base, { enabled: false }, NOW)
    expect(changedJob(paused, { enabled: true }, NOW + MINUTE).nextRunAt).toBe(NOW + 61 * MINUTE)
    expect(changedJob(base, { check: null }, NOW)).not.toHaveProperty("check")
  })
})

function toolsSetup(callerOf: (agentId: string) => ScheduleCaller) {
  const setup = scheduleSetup()
  let ids = 0
  let changes = 0
  const peerTurns = new Set<string>()
  const tools = createScheduleTools({
    caller: (_botId, token, agentId) =>
      token === "tok" ? callerOf(agentId) : { kind: "refused", reason: "stale revision" },
    store: setup.store,
    runner: setup.runner,
    changed: () => {
      changes += 1
    },
    botTimezone: () => "UTC",
    peerTurn: (agentId) => peerTurns.has(agentId),
    now: setup.clock.now,
    newId: () => `job-${++ids}`,
    warn: () => {},
  })
  return { ...setup, tools, peerTurns, changes: () => changes }
}

const mainOrRun = (agentId: string): ScheduleCaller =>
  agentId === "main-1"
    ? { kind: "main", sessionId: "main-1" }
    : agentId === "sep-1"
      ? { kind: "run", sessionId: "sep-1", jobId: "job-1" }
      : { kind: "refused", reason: "Main session only" }

describe("schedule tools", () => {
  const create = {
    action: "create",
    name: "Digest",
    mode: "separate",
    schedule: { kind: "every", interval: "1h" },
    instruction: "Check the feed.",
  }

  it("manages jobs from the Main session and answers with the next runs", async () => {
    const { tools, changes } = toolsSetup(mainOrRun)
    const call = (args: unknown) =>
      tools.call("b1", "tok", { agentId: "main-1", tool: "schedule", args })
    const created = await call(create)
    expect(created.text).toContain('"Digest" (job-1) — separate, every 1h')
    expect(created.data).toMatchObject({
      job: {
        next_runs: [
          "2026-11-23T11:00:00+00:00",
          "2026-11-23T12:00:00+00:00",
          "2026-11-23T13:00:00+00:00",
        ],
      },
    })
    const updated = await call({ action: "update", id: "job-1", enabled: false })
    expect(updated.data).toMatchObject({ job: { enabled: false, next_runs: [] } })
    expect((await call({ action: "list" })).data).toMatchObject({ jobs: [{ id: "job-1" }] })
    await expect(call({ action: "update", id: "nope", name: "x" })).rejects.toThrow('no job "nope"')
    await expect(call({ ...create, schedule: { kind: "every", interval: "1m" } })).rejects.toThrow(
      /5 minutes/,
    )
    await expect(call({ ...create, color: "red" })).rejects.toThrow(/color|Unrecognized/)
    await call({ action: "delete", id: "job-1" })
    expect((await call({ action: "list" })).text).toBe("No jobs.")
    expect(changes()).toBe(3)
  })

  it("keeps a bot to 20 jobs", async () => {
    const { tools } = toolsSetup(mainOrRun)
    const call = (args: unknown) =>
      tools.call("b1", "tok", { agentId: "main-1", tool: "schedule", args })
    for (let index = 0; index < 20; index += 1) await call(create)
    await expect(call(create)).rejects.toThrow(/already has 20 jobs/)
  })

  it("starts a run on request and refuses one while it runs", async () => {
    const { tools, notices } = toolsSetup(mainOrRun)
    const call = (args: unknown) =>
      tools.call("b1", "tok", { agentId: "main-1", tool: "schedule", args })
    await call(create)
    expect((await call({ action: "run", id: "job-1" })).text).toContain("reaches you later")
    await settle()
    await expect(call({ action: "run", id: "job-1" })).rejects.toThrow(/still running/)
    expect(notices).toEqual([])
  })

  it("lets a separate run's session change only its own job and report once", async () => {
    const setup = toolsSetup(mainOrRun)
    const { tools } = setup
    await tools.call("b1", "tok", { agentId: "main-1", tool: "schedule", args: create })
    const runCall = (tool: "schedule" | "schedule_result", args: unknown) =>
      tools.call("b1", "tok", { agentId: "sep-1", tool, args })
    await expect(runCall("schedule", { action: "list" })).rejects.toThrow(/only update or delete/)
    await expect(runCall("schedule", { action: "update", id: "job-9", name: "x" })).rejects.toThrow(
      /own job/,
    )
    expect((await runCall("schedule", { action: "update", name: "Feed" })).data).toMatchObject({
      job: { id: "job-1", name: "Feed" },
    })
    const target = setup.store.job("job-1")
    if (target === undefined) throw new Error("job missing")
    const done = setup.runner.start(target, "schedule", NOW)
    await settle()
    await expect(runCall("schedule_result", { outcome: "report" })).rejects.toThrow(/report/)
    await runCall("schedule_result", { outcome: "report", report: "News" })
    await expect(runCall("schedule_result", { outcome: "nothing" })).rejects.toThrow(/already/)
    setup.runner.sessionEvent("sep-1", turnEnd({ kind: "completed" }))
    expect((await done).state).toBe("reported")
    await expect(
      tools.call("b1", "tok", {
        agentId: "main-1",
        tool: "schedule_result",
        args: { outcome: "nothing" },
      }),
    ).rejects.toThrow(/separate run/)
  })

  it("shows each tool only to the sessions that may use it", async () => {
    const { tools } = toolsSetup(mainOrRun)
    expect(tools.available("b1", "tok", "main-1", "schedule")).toBe(true)
    expect(tools.available("b1", "tok", "main-1", "schedule_result")).toBe(false)
    expect(tools.available("b1", "tok", "sep-1", "schedule_result")).toBe(true)
    expect(tools.available("b1", "tok", "other", "schedule")).toBe(false)
    expect(tools.available("b1", "old", "main-1", "schedule")).toBe(false)
    await expect(
      tools.call("b1", "tok", { agentId: "other", tool: "schedule", args: { action: "list" } }),
    ).rejects.toThrow("Main session only")
  })
})

describe("schedule row", () => {
  it("registers both tools behind their availability and passes calls with its token", async () => {
    const calls: string[] = []
    const registered = new Map<
      string,
      {
        definition: { description: string; execute(args: unknown, exec: unknown): Promise<unknown> }
        when: (context: { agent: { id: string } }) => boolean
      }
    >()
    const bot = {
      [SCHEDULE_TOOL_AVAILABLE]: (_b: string, _t: string, agentId: string, tool: string) =>
        agentId === "main-1" && tool === "schedule",
      [CALL_SCHEDULE_TOOL]: async (botId: string, token: string, request: { tool: string }) => {
        calls.push(`${botId} ${token} ${request.tool}`)
        return { text: "done", data: null }
      },
    }
    const disposers: (() => void)[] = []
    const ctx = {
      get: () => bot,
      tools: {
        register(
          definition: {
            name: string
            description: string
            execute(args: unknown, exec: unknown): Promise<unknown>
          },
          options: { when: (context: { agent: { id: string } }) => boolean },
        ) {
          registered.set(definition.name, { definition, when: options.when })
          return () => registered.delete(definition.name)
        },
      },
      effect(setup: () => () => void) {
        disposers.push(setup())
      },
    }
    new BotScheduleTools(ctx as unknown as Context, { botId: "b1", token: "tok" })
    expect([...registered.keys()]).toEqual(["schedule", "schedule_result"])
    expect(registered.get("schedule")?.when({ agent: { id: "main-1" } })).toBe(true)
    expect(registered.get("schedule_result")?.when({ agent: { id: "main-1" } })).toBe(false)
    expect(registered.get("schedule")?.definition.description).toContain(MODE_RULE)
    expect(SCHEDULE_DESCRIPTION).toContain("use a background command instead of a schedule")
    const result = await registered
      .get("schedule")
      ?.definition.execute({ action: "list" }, { agent: { id: "main-1" } })
    expect(result).toEqual({ text: "done", data: null })
    expect(calls).toEqual(["b1 tok schedule"])
    for (const dispose of disposers) dispose()
    expect(registered.size).toBe(0)
  })
})

describe("schedule check", () => {
  const subprocess = (exitCode: number | null, abort?: () => void) => ({
    spawn(spec: { argv: readonly string[]; cwd: string }) {
      abort?.()
      return {
        stdin: undefined,
        collected: {
          stdout: {
            readFrom: () => ({ text: `${spec.argv.join(" ")} in ${spec.cwd}\n`, lossy: true }),
          },
          stderr: { readFrom: () => ({ text: " warn \n" }) },
        },
        done: Promise.resolve({ exitCode, signal: null }),
      }
    },
  })

  it("runs bash -c in the bot's workspace, and tells a time-out", async () => {
    const check = { command: "ls", timeoutSeconds: 5 }
    const run = createCheckRunner({
      environmentOf: (botId) =>
        botId === "b1"
          ? { subprocess: subprocess(0), workspace: "/home/bot/workspace" }
          : undefined,
      deadline: () => new AbortController().signal,
    })
    expect(await run("b1", check)).toEqual({
      kind: "exited",
      exitCode: 0,
      signal: null,
      stdout: { text: "bash -c ls in /home/bot/workspace", truncated: true },
      stderr: "warn",
    })
    await expect(run("b2", check)).rejects.toThrow(/not ready/)
    const controller = new AbortController()
    const slow = createCheckRunner({
      environmentOf: () => ({
        subprocess: subprocess(null, () => controller.abort()),
        workspace: "/w",
      }),
      deadline: () => controller.signal,
    })
    expect(await slow("b1", check)).toEqual({ kind: "timed-out", stderr: "warn" })
  })
})
