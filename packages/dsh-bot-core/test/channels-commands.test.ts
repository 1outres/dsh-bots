import { describe, expect, it } from "vitest"
import { createCommandRunner, type MainAgentView } from "../src/host/channels/commands"

function setup(agent: MainAgentView | undefined, cancel: () => Promise<void> = async () => {}) {
  const cancelled: string[] = []
  const runner = createCommandRunner({
    mainSessionOf: (botId) => (botId === "a" ? "main-a" : undefined),
    agentOf: () => agent,
    async cancel(sessionId) {
      cancelled.push(sessionId)
      await cancel()
    },
    startNew: async () => ({ outcome: "started", sessionId: "main-b" }),
  })
  return { runner, cancelled }
}

describe("commands", () => {
  it("stop a running turn the way the Web UI does, and report an idle one", async () => {
    const running = setup({ activity: "running", queued: 0 })
    expect(await running.runner.run("a", "stop")).toEqual({
      ok: true,
      result: { command: "stop", outcome: "stopped" },
    })
    expect(running.cancelled).toEqual(["main-a"])
    const idle = setup({ activity: "idle", queued: 0 })
    expect(await idle.runner.run("a", "stop")).toEqual({
      ok: true,
      result: { command: "stop", outcome: "idle" },
    })
    expect(idle.cancelled).toEqual([])
    const failing = setup({ activity: "running", queued: 0 }, async () => {
      throw new Error("not attached")
    })
    expect(await failing.runner.run("a", "stop")).toEqual({
      ok: false,
      message: "The turn could not be stopped: not attached",
    })
  })

  it("report the Main session's activity, model and queue", async () => {
    const model = { provider: "deepseek", model: "deepseek-chat" }
    expect(
      await setup({ activity: "running", model, queued: 2 }).runner.run("a", "status"),
    ).toEqual({
      ok: true,
      result: {
        command: "status",
        status: { activity: "running", loaded: true, model, queued: 2 },
      },
    })
    expect(await setup(undefined).runner.run("a", "status")).toEqual({
      ok: true,
      result: { command: "status", status: { activity: "idle", loaded: false, queued: 0 } },
    })
    expect(await setup(undefined).runner.run("b", "status")).toMatchObject({ ok: false })
  })
})
