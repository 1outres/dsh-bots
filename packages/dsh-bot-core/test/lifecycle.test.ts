import { describe, expect, it } from "vitest"
import type { BotSessions } from "../src/host/cleanup"
import type { EnvironmentStatus, RemovalStatus } from "../src/host/environment"
import { type BotLifecycleDeps, createBotLifecycle, creationPhase } from "../src/host/lifecycle"
import { createSessionPreparations } from "../src/host/preparations"
import type { CreatingBot, CreationFailure, RemovedBot } from "../src/host/registry"
import type { EnvironmentPhase } from "../src/shared/bots"
import type { BotPresetState } from "../src/shared/preset"

const avatar = { kind: "emoji", emoji: "🤖", color: "#6366F1" } as const
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function setup() {
  let clock = 100
  const creating = new Map<string, CreatingBot>()
  const registryListeners = new Set<() => void>()
  const statusListeners = new Set<(id: string) => void>()
  const activityListeners = new Set<(id: string) => void>()
  const statuses = new Map<string, EnvironmentStatus>()
  const progress = new Map<string, EnvironmentPhase>()
  const removals = new Map<string, RemovalStatus>()
  const presets = new Map<string, BotPresetState>()
  const registered = new Set<string>()
  const calls: string[] = []
  const cleanups: BotSessions[] = []
  const warnings: string[] = []
  let cleanupError: Error | undefined
  const publish = () => {
    for (const listener of [...registryListeners]) listener()
  }
  const preparations = createSessionPreparations()
  const deps: BotLifecycleDeps = {
    preparations,
    registry: {
      list: () => [],
      creating: () => [...creating.values()],
      async create(input) {
        const id = `b${creating.size + 1}`
        creating.set(id, {
          id,
          name: input.name,
          avatar: input.avatar,
          createdAt: clock,
          sessionIds: [],
          startingMain: false,
        })
        publish()
        return id
      },
      async remove(id, expected, removed) {
        const bot = creating.get(id)
        if (bot === undefined) throw new Error(`bot "${id}" does not exist`)
        calls.push(`remove ${id} ${expected}`)
        creating.delete(id)
        const gone: RemovedBot = {
          id,
          name: bot.name,
          avatar: bot.avatar,
          createdAt: bot.createdAt,
          sessionIds: bot.sessionIds,
          mainSessionId: undefined,
          workspaceId: undefined,
        }
        removed(gone)
        removals.set(id, { state: "running" })
        publish()
      },
      async forget(sessionIds) {
        calls.push(`forget ${sessionIds.join(",")}`)
      },
      async failCreation(id, failure: CreationFailure) {
        const bot = creating.get(id)
        if (bot === undefined || bot.failure !== undefined) return false
        creating.set(id, { ...bot, failure })
        publish()
        return true
      },
      async retryCreation(id) {
        const bot = creating.get(id)
        if (bot?.failure === undefined) throw new Error("has not failed")
        const { failure: _failure, ...rest } = bot
        creating.set(id, rest)
        publish()
      },
      async repairMains(ids) {
        calls.push(`repair ${[...(ids ?? [])].join(",")}`)
      },
      subscribe(listener) {
        registryListeners.add(listener)
        return () => registryListeners.delete(listener)
      },
    },
    environment: {
      status: (id) => statuses.get(id) ?? { ready: false, problem: "preparing", pending: true },
      progress: (id) => progress.get(id),
      removal: (id) => removals.get(id),
      retry: (id) => {
        calls.push(`ensure ${id}`)
        statuses.set(id, { ready: false, problem: "preparing", pending: true })
      },
      retryRemoval: (id) => {
        calls.push(`retry removal ${id}`)
      },
      subscribe(listener) {
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
      onActivity(listener) {
        activityListeners.add(listener)
        return () => activityListeners.delete(listener)
      },
    },
    preset: {
      settle: async (id) => presets.get(id),
      registered: (id) => registered.has(id),
    },
    async cleanup(bot) {
      cleanups.push(bot)
      if (cleanupError !== undefined) throw cleanupError
    },
    now: () => clock,
    warn: (message) => warnings.push(message),
  }
  const lifecycle = createBotLifecycle(deps)
  let changes = 0
  lifecycle.subscribe(() => changes++)
  return {
    lifecycle,
    preparations,
    creating,
    calls,
    cleanups,
    warnings,
    presets,
    registered,
    removals,
    changes: () => changes,
    tick(ms: number) {
      clock += ms
    },
    failCleanup(error: Error | undefined) {
      cleanupError = error
    },
    environmentIs(id: string, status: EnvironmentStatus) {
      statuses.set(id, status)
      for (const listener of [...statusListeners]) listener(id)
    },
    reports(id: string, phase: EnvironmentPhase) {
      progress.set(id, phase)
      for (const listener of [...activityListeners]) listener(id)
    },
    removalIs(id: string, status: RemovalStatus | undefined) {
      if (status === undefined) removals.delete(id)
      else removals.set(id, status)
      for (const listener of [...activityListeners]) listener(id)
    },
    pending: (id: string) => lifecycle.snapshot().pending.find((item) => item.id === id),
  }
}

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("sessions being prepared", () => {
  it("lists a session until every preparation of it settled, telling subscribers when the list changes", async () => {
    const h = setup()
    const first = deferred()
    const second = deferred()
    const other = deferred()
    const runs = [
      h.preparations.run("s1", () => first.promise),
      h.preparations.run("s2", () => other.promise),
      h.preparations.run("s1", () => second.promise),
    ]
    expect(h.lifecycle.snapshot().preparingSessionIds).toEqual(["s1", "s2"])
    expect(h.changes()).toBe(2)
    first.resolve()
    await runs[0]
    expect(h.lifecycle.snapshot().preparingSessionIds).toEqual(["s1", "s2"])
    second.reject(new Error("failed"))
    await expect(runs[2]).rejects.toThrow("failed")
    expect(h.lifecycle.snapshot().preparingSessionIds).toEqual(["s2"])
    expect(h.changes()).toBe(3)
  })
})

describe("creationPhase", () => {
  const preparing: EnvironmentStatus = { ready: false, problem: "p", pending: true }
  it("is the failed step, Main starting, the preset once ready, else the environment's step", () => {
    const failure = { phase: "booting" as const, message: "x", at: 1 }
    expect(creationPhase({ startingMain: true, failure }, preparing, "connecting")).toBe("booting")
    expect(creationPhase({ startingMain: true }, { ready: true }, undefined)).toBe("starting-main")
    expect(creationPhase({ startingMain: false }, { ready: true }, "connecting")).toBe("preset")
    expect(creationPhase({ startingMain: false }, preparing, "creating")).toBe("creating")
    expect(creationPhase({ startingMain: false }, preparing, undefined)).toBe("queued")
  })
})

describe("createBotLifecycle", () => {
  it("lists a creation at once with its steps and the start of its attempt", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    expect(h.pending(id)).toEqual({
      id,
      name: "New",
      avatar,
      operation: { kind: "create", phase: "queued" },
      startedAt: 100,
      sessionIds: [],
      createdAt: 100,
    })
    h.reports(id, "creating")
    expect(h.pending(id)?.operation).toEqual({ kind: "create", phase: "creating" })
    expect(h.changes()).toBeGreaterThanOrEqual(2)
    h.environmentIs(id, { ready: true })
    await settle()
    expect(h.pending(id)?.operation).toEqual({ kind: "create", phase: "preset" })
  })

  it("stops a creation whose environment fails, at the step it reached", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.reports(id, "booting")
    h.tick(5)
    h.environmentIs(id, { ready: false, problem: "no vsock id" })
    await settle()
    expect(h.pending(id)).toMatchObject({
      operation: { kind: "create", phase: "booting" },
      failure: { message: "no vsock id", at: 105 },
    })
    expect(h.warnings).toEqual([expect.stringContaining("no vsock id")])
    h.environmentIs(id, { ready: false, problem: "other" })
    await settle()
    expect(h.pending(id)?.failure?.message).toBe("no vsock id")
  })

  it("keeps a creation queued while its environment is only pending", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.environmentIs(id, { ready: false, problem: "no environment", pending: true })
    await settle()
    expect(h.pending(id)?.failure).toBeUndefined()
  })

  it("stops a creation whose preset cannot be composed once its environment is ready", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.presets.set(id, { id: `bot-${id}`, ready: false, template: "t", problem: "bad overlay" })
    h.environmentIs(id, { ready: true })
    await settle()
    expect(h.pending(id)).toMatchObject({
      operation: { kind: "create", phase: "preset" },
      failure: { message: "bad overlay" },
    })
  })

  it("keeps waiting while the preset is pending or ready", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.presets.set(id, {
      id: `bot-${id}`,
      ready: false,
      template: "t",
      problem: "template missing",
      pending: true,
    })
    h.environmentIs(id, { ready: true })
    await settle()
    expect(h.pending(id)?.failure).toBeUndefined()
  })

  it("retries a failed creation: a new attempt, the environment again, and Main when the preset is ready", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.environmentIs(id, { ready: false, problem: "quota" })
    await settle()
    h.tick(1000)
    await h.lifecycle.retryCreate(id)
    expect(h.pending(id)).toMatchObject({ startedAt: 1100, operation: { phase: "queued" } })
    expect(h.pending(id)?.failure).toBeUndefined()
    expect(h.calls).toEqual([`ensure ${id}`])
    h.registered.add(id)
    h.environmentIs(id, { ready: false, problem: "quota" })
    await settle()
    await h.lifecycle.retryCreate(id)
    expect(h.calls).toEqual([`ensure ${id}`, `ensure ${id}`, `repair ${id}`])
  })

  it("lists a removal until its sessions are cleaned up and its environment removed", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.creating.set(id, { ...(h.creating.get(id) as CreatingBot), sessionIds: ["s1"] })
    h.tick(10)
    await h.lifecycle.discardCreate(id)
    expect(h.calls[0]).toBe(`remove ${id} creating`)
    expect(h.pending(id)).toMatchObject({
      operation: { kind: "remove" },
      startedAt: 110,
      sessionIds: ["s1"],
    })
    await settle()
    expect(h.cleanups).toHaveLength(1)
    expect(h.calls).toContain("forget s1")
    expect(h.pending(id)).toBeDefined()
    h.removalIs(id, undefined)
    expect(h.pending(id)).toBeUndefined()
  })

  it("shows the environment's removal failure, and retries it", async () => {
    const h = setup()
    const id = await h.lifecycle.create({
      name: "New",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    await h.lifecycle.discardCreate(id)
    await settle()
    await expect(h.lifecycle.retryRemove(id)).rejects.toThrow("has not failed")
    h.removalIs(id, { state: "failed", problem: "incus busy", at: 7 })
    expect(h.pending(id)?.failure).toEqual({ message: "incus busy", at: 7 })
    h.tick(50)
    await h.lifecycle.retryRemove(id)
    expect(h.calls).toContain(`retry removal ${id}`)
    expect(h.pending(id)?.startedAt).toBe(150)
    h.removalIs(id, undefined)
    expect(h.pending(id)).toBeUndefined()
    await expect(h.lifecycle.retryRemove(id)).rejects.toThrow("not being removed")
  })

  it("shows a cleanup failure, runs it again on a retry, and forgets a dismissed removal", async () => {
    const h = setup()
    const first = await h.lifecycle.create({
      name: "First",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    const second = await h.lifecycle.create({
      name: "Second",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.failCleanup(new Error("session busy"))
    await h.lifecycle.discardCreate(first)
    await h.lifecycle.discardCreate(second)
    await settle()
    expect(h.pending(first)?.failure?.message).toBe("session busy")
    h.removalIs(first, undefined)
    h.removalIs(second, undefined)
    expect(h.pending(first)).toBeDefined()
    h.failCleanup(undefined)
    await h.lifecycle.retryRemove(first)
    await settle()
    expect(h.cleanups).toHaveLength(3)
    expect(h.pending(first)).toBeUndefined()
    await h.lifecycle.dismissRemove(second)
    expect(h.pending(second)).toBeUndefined()
    expect(h.lifecycle.snapshot()).toEqual({ bots: [], pending: [], preparingSessionIds: [] })
  })

  it("orders pending bots by creation, and stops following on dispose", async () => {
    const h = setup()
    const first = await h.lifecycle.create({
      name: "First",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    h.tick(1)
    const second = await h.lifecycle.create({
      name: "Second",
      avatar,
      workstation: false,
      language: "en",
      timezone: "Asia/Tokyo",
    })
    expect(h.lifecycle.snapshot().pending.map((item) => item.id)).toEqual([first, second])
    h.lifecycle.dispose()
    const before = h.changes()
    h.environmentIs(first, { ready: false, problem: "late" })
    await settle()
    expect(h.changes()).toBe(before)
    expect(h.pending(first)?.failure).toBeUndefined()
  })
})
