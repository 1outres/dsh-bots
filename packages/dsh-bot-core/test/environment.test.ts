import { describe, expect, it } from "vitest"
import type { BotEnvironment, BotEnvironmentTarget, EnsureOptions } from "../src/contract"
import { createEnvironmentKeeper, workspaceProblem } from "../src/host/environment"
import { DEFAULT_BOT_ENVIRONMENT_SPEC } from "../src/shared/environment"
import { TEST_CAPACITY } from "./support/environment"

function manualClock() {
  let tasks: { work: () => void; at: number; cancelled: boolean }[] = []
  let now = 0
  return {
    later(work: () => void, ms: number) {
      const task = { work, at: now + ms, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    async tick(ms = 0) {
      now += ms
      const due = tasks.filter((task) => task.at <= now)
      tasks = tasks.filter((task) => task.at > now)
      for (const task of due) if (!task.cancelled) task.work()
      await settle()
    },
    delays: () => tasks.filter((task) => !task.cancelled).map((task) => task.at - now),
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function fakeEnvironment(id = "vm") {
  const calls: {
    target: BotEnvironmentTarget
    signal?: AbortSignal | undefined
    progress: NonNullable<EnsureOptions["progress"]>
    settle(error?: Error): void
  }[] = []
  const removed: string[] = []
  const listeners = new Set<(botId: string) => void>()
  const environment: BotEnvironment = {
    id,
    isolate: ["fs"],
    workspace: "/home/bot/workspace",
    ensure: (target, options) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          target,
          signal: options?.signal,
          progress: (phase) => options?.progress?.(phase),
          settle: (error) => (error === undefined ? resolve() : reject(error)),
        })
      }),
    remove: async (botId) => {
      removed.push(botId)
    },
    rows: (target) => [{ id: "env-fs", name: "@x/fs", config: { bot: target.id } }],
    capacity: async () => TEST_CAPACITY,
    inspect: async () => undefined,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    environment,
    calls,
    removed,
    listeners,
    finish(botId: string, error?: Error) {
      const call = calls.filter((entry) => entry.target.id === botId).at(-1)
      call?.settle(error)
    },
  }
}

function setup(ids: string[] = ["a"]) {
  const bots = new Map(ids.map((id) => [id, { name: id.toUpperCase() }]))
  const clock = manualClock()
  const released: string[] = []
  const changed: string[] = []
  const warnings: string[] = []
  const held = new Set<string>()
  const activity: string[] = []
  const keeper = createEnvironmentKeeper({
    target: (id) => {
      const bot = bots.get(id)
      return bot === undefined ? undefined : { id, ...bot }
    },
    spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
    adopt: async () => {},
    botIds: () => bots.keys(),
    held: (id) => held.has(id),
    release: async (id) => {
      released.push(id)
    },
    later: clock.later,
    now: () => 42,
    warn: (message) => warnings.push(message),
    retryMs: 100,
    maxRetryMs: 400,
    graceMs: 60_000,
  })
  keeper.subscribe((id) => changed.push(id))
  keeper.onActivity((id) => activity.push(id))
  return { bots, clock, released, changed, warnings, held, activity, keeper }
}

describe("createEnvironmentKeeper", () => {
  it("is not ready without an environment (fail closed), pending", async () => {
    const { keeper } = setup()
    await keeper.sync()
    expect(keeper.status("a")).toMatchObject({ ready: false, pending: true })
    expect(keeper.layer({ id: "a", name: "A" })).toBeUndefined()
  })

  it("ensures every stored bot on registration and is ready once ensure resolves", async () => {
    const { keeper, changed } = setup(["a", "b"])
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    expect(fake.calls.map((call) => call.target)).toEqual([
      { id: "a", name: "A", spec: DEFAULT_BOT_ENVIRONMENT_SPEC },
      { id: "b", name: "B", spec: DEFAULT_BOT_ENVIRONMENT_SPEC },
    ])
    expect(keeper.status("a")).toMatchObject({
      ready: false,
      pending: true,
      problem: expect.stringContaining("being prepared"),
    })
    fake.finish("a")
    await settle()
    expect(keeper.status("a")).toEqual({ ready: true })
    expect(keeper.status("b")).toMatchObject({ ready: false, pending: true })
    expect(changed).toContain("a")
    expect(keeper.layer({ id: "a", name: "A" })).toEqual({
      id: "vm",
      isolate: ["fs"],
      rows: [{ id: "env-fs", name: "@x/fs", config: { bot: "a" } }],
    })
  })

  it("refuses a second environment", () => {
    const { keeper } = setup()
    keeper.register(fakeEnvironment().environment)
    expect(() => keeper.register(fakeEnvironment("other").environment)).toThrow(
      "already registered",
    )
  })

  it("refuses an environment whose workspace is not absolute and normalized", () => {
    const { keeper } = setup()
    for (const workspace of [
      "home/bot",
      "/home/bot/",
      "/home//bot",
      "/home/./bot",
      "/a/../b",
      "",
    ]) {
      expect(() => keeper.register({ ...fakeEnvironment().environment, workspace })).toThrow(
        "workspace",
      )
    }
    expect(workspaceProblem("/home/bot/workspace")).toBeUndefined()
    expect(keeper.current()).toBeUndefined()
  })

  it("ensures a bot stored later on the next sync", async () => {
    const { keeper, bots } = setup([])
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    bots.set("n", { name: "N" })
    await keeper.sync()
    await keeper.sync()
    expect(fake.calls.map((call) => call.target.id)).toEqual(["n"])
  })

  it("retries a rejected ensure with a doubling, capped backoff, not pending meanwhile", async () => {
    const { keeper, clock, warnings } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    const delays: number[] = []
    for (let attempt = 0; attempt < 4; attempt++) {
      fake.finish("a", new Error("no capacity"))
      await settle()
      expect(keeper.status("a")).toEqual({
        ready: false,
        problem: expect.stringContaining("no capacity"),
      })
      const next = Math.min(...clock.delays())
      delays.push(next)
      await clock.tick(next)
      expect(keeper.status("a")).toMatchObject({
        ready: false,
        problem: expect.stringContaining("no capacity"),
      })
      expect(keeper.status("a")).not.toHaveProperty("pending")
    }
    expect(delays).toEqual([100, 200, 400, 400])
    expect(fake.calls).toHaveLength(5)
    expect(warnings).toHaveLength(1)
    fake.finish("a")
    await settle()
    expect(keeper.status("a")).toEqual({ ready: true })
  })

  it("re-ensures on onChange and stays ready unless it fails", async () => {
    const { keeper } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    fake.finish("a")
    await settle()
    for (const listener of fake.listeners) listener("a")
    await settle()
    expect(fake.calls).toHaveLength(2)
    expect(keeper.status("a")).toEqual({ ready: true })
    fake.finish("a", new Error("vm stopped"))
    await settle()
    expect(keeper.status("a")).toMatchObject({
      ready: false,
      problem: expect.stringContaining("vm stopped"),
    })
    for (const listener of fake.listeners) listener("zz")
    await settle()
    expect(fake.calls).toHaveLength(2)
  })

  it("aborts and fails closed when the environment is unregistered", async () => {
    const { keeper, changed, clock } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    const unregister = keeper.register(fake.environment)
    await settle()
    fake.finish("a")
    await settle()
    for (const listener of fake.listeners) listener("a")
    await settle()
    const inflight = fake.calls[1]
    changed.length = 0
    unregister()
    expect(inflight?.signal?.aborted).toBe(true)
    expect(fake.listeners.size).toBe(0)
    expect(keeper.status("a")).toMatchObject({ ready: false, pending: true })
    expect(changed).toEqual(["a"])
    fake.finish("a")
    await clock.tick(1000)
    expect(keeper.status("a")).toMatchObject({ ready: false })
    expect(keeper.current()).toBeUndefined()
  })

  it("removes a deleted bot's environment after releasing its preset", async () => {
    const { keeper, bots, released } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    const signal = fake.calls[0]?.signal
    bots.delete("a")
    const sync = keeper.sync()
    expect(keeper.removal("a")).toEqual({ state: "running" })
    await sync
    expect(signal?.aborted).toBe(true)
    expect(released).toEqual(["a"])
    expect(fake.removed).toEqual(["a"])
    expect(keeper.removal("a")).toBeUndefined()
  })

  it("removes bots deleted without an environment once one registers", async () => {
    const { keeper, bots } = setup()
    await keeper.sync()
    bots.delete("a")
    await keeper.sync()
    expect(keeper.removal("a")).toMatchObject({
      state: "failed",
      problem: expect.stringContaining("no bot environment is registered"),
    })
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    expect(fake.removed).toEqual(["a"])
    expect(fake.calls).toEqual([])
    expect(keeper.removal("a")).toBeUndefined()
  })

  it("keeps the step an ensure reports, until the next ensure starts", async () => {
    const { keeper, activity } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    expect(keeper.progress("a")).toBeUndefined()
    fake.calls[0]?.progress("creating")
    fake.calls[0]?.progress("creating")
    fake.calls[0]?.progress("booting")
    expect(keeper.progress("a")).toBe("booting")
    expect(activity).toEqual(["a", "a"])
    fake.finish("a", new Error("no ssh"))
    await settle()
    expect(keeper.progress("a")).toBe("booting")
    for (const listener of fake.listeners) listener("a")
    await settle()
    expect(keeper.progress("a")).toBeUndefined()
    fake.calls[0]?.progress("connecting")
    expect(keeper.progress("a")).toBeUndefined()
  })

  it("does not ensure a held bot, not even by a scheduled retry, until it is retried", async () => {
    const { keeper, clock, held } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    fake.finish("a", new Error("image missing"))
    await settle()
    held.add("a")
    await clock.tick(1000)
    for (const listener of fake.listeners) listener("a")
    await settle()
    expect(fake.calls).toHaveLength(1)
    keeper.retry("a")
    expect(fake.calls).toHaveLength(1)
    held.delete("a")
    keeper.retry("a")
    expect(keeper.status("a")).toMatchObject({ ready: false, pending: true })
    await settle()
    expect(fake.calls).toHaveLength(2)
    fake.finish("a")
    await settle()
    expect(keeper.status("a")).toEqual({ ready: true })
  })

  it("schedules no retry for a bot held when its ensure fails", async () => {
    const { keeper, clock, held } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    held.add("a")
    fake.finish("a", new Error("x"))
    await settle()
    expect(clock.delays().filter((delay) => delay < 60_000)).toEqual([])
  })

  it("runs a failed removal again at once on retryRemoval", async () => {
    const { keeper, bots, clock } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    let failures = 1
    fake.environment.remove = async (botId) => {
      if (failures-- > 0) throw new Error("busy")
      fake.removed.push(botId)
    }
    keeper.register(fake.environment)
    await settle()
    bots.delete("a")
    await keeper.sync()
    expect(keeper.removal("a")).toMatchObject({ state: "failed" })
    keeper.retryRemoval("a")
    await settle()
    expect(fake.removed).toEqual(["a"])
    expect(keeper.removal("a")).toBeUndefined()
    await clock.tick(1000)
    expect(fake.removed).toEqual(["a"])
  })

  it("aborts every ensure on dispose and removes nothing", async () => {
    const { keeper, bots, clock } = setup()
    await keeper.sync()
    const fake = fakeEnvironment()
    keeper.register(fake.environment)
    await settle()
    fake.finish("a", new Error("x"))
    await settle()
    keeper.dispose()
    expect(clock.delays()).toEqual([])
    bots.delete("a")
    await keeper.sync()
    expect(fake.removed).toEqual([])
    expect(() => keeper.register(fakeEnvironment().environment)).toThrow("unloading")
  })
})

describe("createEnvironmentKeeper, configured", () => {
  it("accepts only the configured environment id", () => {
    const keeper = createEnvironmentKeeper({
      target: () => undefined,
      spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
      adopt: async () => {},
      botIds: () => [],
      held: () => false,
      release: async () => {},
      later: () => () => {},
      now: () => 0,
      warn: () => {},
      acceptedId: "incus-vm",
    })
    expect(() => keeper.register(fakeEnvironment("other").environment)).toThrow("not accepted")
    expect(() => keeper.register(fakeEnvironment("incus-vm").environment)).not.toThrow()
  })

  it("warns once when no environment registers within the grace period", async () => {
    const clock = manualClock()
    const warnings: string[] = []
    const keeper = createEnvironmentKeeper({
      target: (id) => ({ id, name: id }),
      spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
      adopt: async () => {},
      botIds: () => ["a"],
      held: () => false,
      release: async () => {},
      later: clock.later,
      now: () => 0,
      warn: (message) => warnings.push(message),
      graceMs: 1000,
    })
    await keeper.sync()
    await clock.tick(1000)
    await clock.tick(5000)
    expect(warnings).toEqual([expect.stringContaining("no bot environment is registered")])
  })

  it("retries a failed removal with backoff", async () => {
    const clock = manualClock()
    const bots = new Set(["a"])
    const keeper = createEnvironmentKeeper({
      target: (id) => (bots.has(id) ? { id, name: id } : undefined),
      spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
      adopt: async () => {},
      botIds: () => bots,
      held: () => false,
      release: async () => {},
      later: clock.later,
      now: () => 7,
      warn: () => {},
      retryMs: 100,
      graceMs: 60_000,
    })
    await keeper.sync()
    const fake = fakeEnvironment()
    let failures = 2
    fake.environment.remove = async (botId) => {
      if (failures-- > 0) throw new Error("busy")
      fake.removed.push(botId)
    }
    keeper.register(fake.environment)
    await settle()
    bots.delete("a")
    await keeper.sync()
    expect(fake.removed).toEqual([])
    expect(keeper.removal("a")).toEqual({
      state: "failed",
      problem: expect.stringContaining("busy"),
      at: 7,
    })
    await clock.tick(100)
    expect(fake.removed).toEqual([])
    expect(keeper.removal("a")).toMatchObject({ state: "failed", at: 7 })
    await clock.tick(200)
    expect(fake.removed).toEqual(["a"])
    expect(keeper.removal("a")).toBeUndefined()
  })
})
