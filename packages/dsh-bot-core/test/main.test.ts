import { describe, expect, it } from "vitest"
import {
  createMainGuard,
  type EnvironmentWaitDeps,
  greetingText,
  MainSessionArchiveError,
  waitForEnvironment,
} from "../src/host/main"
import type { BotView } from "../src/shared/bots"

const bot: BotView = {
  id: "b1",
  name: "Alpha",
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  mainSessionId: "main",
  mainStartedAt: 0,
  timezone: "UTC",
  sessionIds: [],
  formerMainIds: [],
  createdAt: 0,
}

function guard() {
  const unarchived: string[] = []
  const queued: (() => void)[] = []
  const g = createMainGuard({
    registry: { botOfMain: (id) => (id === "main" ? bot : undefined) },
    unarchive: async (id) => {
      unarchived.push(id)
    },
    warn: () => {},
    later: (work) => queued.push(work),
  })
  return { g, unarchived, queued }
}

describe("Main guard", () => {
  it("refuses a plain archive of a Main session", async () => {
    const { g } = guard()
    await expect(g.activity({ sessionId: "main" }, async () => [])).rejects.toBeInstanceOf(
      MainSessionArchiveError,
    )
    await expect(g.activity({ sessionId: "other" }, async () => ["x"])).resolves.toEqual(["x"])
  })

  it("restores a Main session archived past the check", async () => {
    const { g, unarchived, queued } = guard()
    g.archived({ sessionId: "other" })
    g.archived({ sessionId: "main" })
    expect(unarchived).toEqual([])
    for (const work of queued) work()
    await Promise.resolve()
    expect(unarchived).toEqual(["main"])
  })

  it("fills the bot name into the greeting", () => {
    expect(greetingText("I am {name}. {name}!", bot)).toBe("I am Alpha. Alpha!")
    expect(greetingText("Greet in {language}.", { name: "A", language: "ja" })).toBe(
      "Greet in Japanese.",
    )
    expect(greetingText("Greet in {language}.", { name: "A" })).toBe(
      "Greet in the language your owner writes in.",
    )
  })
})

describe("waiting for a new session's environment", () => {
  function deps(answers: (true | Error)[], overrides: Partial<EnvironmentWaitDeps> = {}) {
    const clock = { now: 0 }
    const log: string[] = []
    const d: EnvironmentWaitDeps = {
      probe: async () => {
        const answer = answers.shift() ?? true
        log.push(answer === true ? "probe ok" : `probe ${answer.message}`)
        if (answer !== true) throw answer
      },
      sleep: async (ms) => {
        clock.now += ms
      },
      now: () => clock.now,
      stopped: () => false,
      warn: (message) => log.push(`warn ${message}`),
      budgetMs: 10_000,
      intervalMs: 3_000,
      probeTimeoutMs: 1_000,
      ...overrides,
    }
    return { d, log, clock }
  }

  it("ends once the environment answers (E2E: the first SSH connect timed out)", async () => {
    const { d, log, clock } = deps([new Error("SSH operation cancelled"), true])
    await expect(waitForEnvironment(d, "Main")).resolves.toBe(true)
    expect(log).toEqual(["probe SSH operation cancelled", "probe ok"])
    expect(clock.now).toBe(3_000)
  })

  it("goes on, with a warning, when the environment never answers within the budget", async () => {
    const { d, log, clock } = deps(Array(10).fill(new Error("down")))
    await expect(waitForEnvironment(d, "Main")).resolves.toBe(true)
    expect(log.filter((line) => line.startsWith("probe"))).toHaveLength(4)
    expect(log.at(-1)).toMatch(
      /^warn bot-core: the environment of Main did not answer within 10 s \(down\); going on anyway/,
    )
    expect(clock.now).toBeLessThan(10_000)
  })

  it("ends at once without anything to check with, and gives up on an unload", async () => {
    const at = deps([], { probe: undefined })
    await expect(waitForEnvironment(at.d, "s")).resolves.toBe(true)
    expect(at.log).toEqual([])
    let stopped = false
    const unloading = deps([new Error("down")], {
      sleep: async () => {
        stopped = true
      },
      stopped: () => stopped,
    })
    await expect(waitForEnvironment(unloading.d, "s")).resolves.toBe(false)
    expect(unloading.log).toEqual(["probe down"])
  })
})
