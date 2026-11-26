import type { MainMaintenance, MainTurnPrompt, MainTurnResult } from "../../mains-contract"
import {
  effectiveMainRotation,
  type MainMaintenanceState,
  type MainRotationOutcome,
  type MainRotationReason,
  type MainRotationRefusal,
} from "../../shared/mains"
import { decideMain, type MainDecision, type MainTrigger } from "./decide"
import type { MainPreparations } from "./preparations"
import { FRESH_ACTIVITY, type MainActivity, type MainStore } from "./store"
import { dailyBoundaryAfter } from "./timing"

export interface MainBot {
  readonly id: string
  readonly name: string
  readonly timezone: string
  readonly mainSessionId: string
}

export interface MainAgentState {
  readonly status: "idle" | "running"
  readonly inboxEmpty: boolean
  readonly usagePercent: number | undefined
}

export interface MainControllerDeps {
  bot(botId: string): MainBot | undefined
  bots(): readonly MainBot[]
  store: MainStore
  agentOf(sessionId: string): MainAgentState | undefined
  resolve(sessionId: string): Promise<MainAgentState>
  openInteractions(botId: string): number
  compact(botId: string, sessionId: string, signal: AbortSignal): Promise<boolean>
  createMain(botId: string, title: string): Promise<string>
  replaceMain(
    botId: string,
    expected: string,
    next: string,
    reason: MainRotationReason,
  ): Promise<void>
  archive(sessionId: string): Promise<void>
  mainChanged(botId: string): void
  preparations: Pick<MainPreparations, "list">
  runTurn(sessionId: string, prompt: MainTurnPrompt): Promise<MainTurnResult>
  now(): number
  later(ms: number, work: () => void): () => void
  deadline(ms: number): AbortSignal
  notReady(error: unknown): boolean
  readonly maintenanceLimitMs: number
  readonly retry: { readonly initialMs: number; readonly maxMs: number }
  warn(message: string): void
}

export interface MainController {
  poke(botId: string): void
  pokeAll(): void
  turnEnded(sessionId: string, at: number): void
  compactionsCounted(sessionId: string, count: number): void
  admit<T>(botId: string, work: (sessionId: string | undefined) => Promise<T>): Promise<T>
  startNew(botId: string): Promise<MainRotationOutcome>
  maintenance(botId: string): MainMaintenanceState
  subscribe(listener: (botId: string) => void): () => void
  dispose(): void
}

interface Entry {
  maintenance:
    | { readonly kind: MainMaintenance["kind"]; readonly done: Promise<unknown> }
    | undefined
  inputs: number
  timer: (() => void) | undefined
  poked: boolean
  retryAt: number | undefined
  failures: number
  writing: Promise<void> | undefined
}

type Attempt =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: MainRotationRefusal; readonly message: string }

const BUSY_MESSAGE =
  "The bot is busy: a turn runs, a message waits, or a question or approval is open. Stop it (/stop) or wait until it is done, then try again."

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createMainController(deps: MainControllerDeps): MainController {
  const entries = new Map<string, Entry>()
  const listeners = new Set<(botId: string) => void>()
  let disposed = false

  const entryOf = (botId: string): Entry => {
    let entry = entries.get(botId)
    if (entry === undefined) {
      entry = {
        maintenance: undefined,
        inputs: 0,
        timer: undefined,
        poked: false,
        retryAt: undefined,
        failures: 0,
        writing: undefined,
      }
      entries.set(botId, entry)
    }
    return entry
  }
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const botOfMain = (sessionId: string) =>
    deps.bots().find((bot) => bot.mainSessionId === sessionId)

  const activityOf = (bot: MainBot): MainActivity => deps.store.activity(bot.id, bot.mainSessionId)

  const decide = (bot: MainBot, trigger: MainTrigger): MainDecision => {
    const now = deps.now()
    const entry = entryOf(bot.id)
    if (entry.retryAt !== undefined && now < entry.retryAt)
      return { kind: "wait", until: entry.retryAt }
    const settings = effectiveMainRotation(deps.store.defaults(), deps.store.override(bot.id))
    const activity = activityOf(bot)
    let dailyBoundary: number | undefined
    if (settings.daily.enabled && activity.firstTurnAt !== undefined) {
      try {
        dailyBoundary = dailyBoundaryAfter(settings.daily.time, bot.timezone, activity.firstTurnAt)
      } catch (error) {
        deps.warn(
          `bot-core: the daily new Main of bot "${bot.name}" cannot be timed: ${messageOf(error)}`,
        )
      }
    }
    return decideMain({
      now,
      trigger,
      settings,
      dailyBoundary,
      facts: {
        ...activity,
        usagePercent: deps.agentOf(bot.mainSessionId)?.usagePercent,
      },
    })
  }

  const looksIdle = (bot: MainBot) => {
    const agent = deps.agentOf(bot.mainSessionId)
    return (
      deps.openInteractions(bot.id) === 0 &&
      (agent === undefined || (agent.status === "idle" && agent.inboxEmpty))
    )
  }
  const idle = (botId: string, agent: MainAgentState) =>
    agent.status === "idle" && agent.inboxEmpty && deps.openInteractions(botId) === 0

  const refuse = (reason: MainRotationRefusal, message: string): Attempt => ({
    ok: false,
    reason,
    message,
  })

  const prepare = async (
    bot: MainBot,
    maintenance: MainMaintenance,
    holdingInput: boolean,
    signal: AbortSignal,
  ): Promise<Attempt | undefined> => {
    const participants = deps.preparations.list()
    for (const participant of participants) {
      try {
        await participant.prepare({
          bot: { id: bot.id, name: bot.name },
          sessionId: bot.mainSessionId,
          maintenance,
          holdingInput,
          signal,
          runTurn: (prompt) => deps.runTurn(bot.mainSessionId, prompt),
        })
      } catch (error) {
        return refuse(
          "preparation-failed",
          `Preparing the Main session failed (${participant.id}): ${messageOf(error)}`,
        )
      }
      if (signal.aborted) {
        return refuse("preparation-failed", "Preparing the Main session took too long.")
      }
    }
    if (participants.length > 0) {
      const agent = await deps.resolve(bot.mainSessionId)
      if (!idle(bot.id, agent)) return refuse("busy", BUSY_MESSAGE)
    }
    return undefined
  }

  const rotate = async (bot: MainBot, reason: MainRotationReason): Promise<Attempt> => {
    let next: string
    try {
      next = await deps.createMain(bot.id, bot.name)
    } catch (error) {
      if (deps.notReady(error)) return refuse("not-ready", messageOf(error))
      throw error
    }
    await deps.replaceMain(bot.id, bot.mainSessionId, next, reason)
    await deps.store.updateActivity(bot.id, next, () => FRESH_ACTIVITY)
    deps.mainChanged(bot.id)
    deps.archive(bot.mainSessionId).catch((error: unknown) => {
      deps.warn(
        `bot-core: could not archive the former Main session "${bot.mainSessionId}" of bot "${bot.name}": ${messageOf(error)}`,
      )
    })
    return { ok: true, sessionId: next }
  }

  const compact = async (bot: MainBot, signal: AbortSignal): Promise<Attempt> => {
    const { lastTurnAt } = activityOf(bot)
    try {
      const compacted = await deps.compact(bot.id, bot.mainSessionId, signal)
      if (!compacted) {
        deps.warn(`bot-core: the idle Main session of bot "${bot.name}" had nothing to compact`)
      }
    } catch (error) {
      deps.warn(
        `bot-core: could not compact the idle Main session of bot "${bot.name}": ${messageOf(error)}`,
      )
    }
    await deps.store.updateActivity(bot.id, bot.mainSessionId, (current) => ({
      ...current,
      ...(lastTurnAt === undefined ? {} : { idleCompactedFor: lastTurnAt }),
    }))
    return { ok: true, sessionId: bot.mainSessionId }
  }

  const attempt = async (
    bot: MainBot,
    maintenance: MainMaintenance,
    holdingInput: boolean,
  ): Promise<Attempt> => {
    const signal = deps.deadline(deps.maintenanceLimitMs)
    const agent = await deps.resolve(bot.mainSessionId)
    if (!idle(bot.id, agent)) return refuse("busy", BUSY_MESSAGE)
    const refused = await prepare(bot, maintenance, holdingInput, signal)
    if (refused !== undefined) return refused
    const current = deps.bot(bot.id)
    if (current?.mainSessionId !== bot.mainSessionId) return refuse("busy", BUSY_MESSAGE)
    return maintenance.kind === "rotate"
      ? rotate(current, maintenance.reason)
      : compact(current, signal)
  }

  const maintain = (
    bot: MainBot,
    maintenance: MainMaintenance,
    holdingInput: boolean,
  ): Promise<Attempt> => {
    const entry = entryOf(bot.id)
    const run = attempt(bot, maintenance, holdingInput)
      .catch((error: unknown): Attempt => {
        deps.warn(`bot-core: the Main maintenance of bot "${bot.name}" failed: ${messageOf(error)}`)
        return refuse("failed", messageOf(error))
      })
      .then((result) => {
        if (maintenance.kind !== "rotate" || maintenance.reason !== "owner") {
          entry.failures = result.ok ? 0 : entry.failures + 1
          entry.retryAt = result.ok
            ? undefined
            : deps.now() +
              Math.min(deps.retry.maxMs, deps.retry.initialMs * 2 ** (entry.failures - 1))
          if (!result.ok && result.reason !== "busy") {
            deps.warn(
              `bot-core: the Main maintenance of bot "${bot.name}" did not happen: ${result.message}`,
            )
          }
        }
        return result
      })
    const done = run.finally(() => {
      if (entry.maintenance?.done === done) entry.maintenance = undefined
      publish(bot.id)
      poke(bot.id)
    })
    entry.maintenance = { kind: maintenance.kind, done }
    publish(bot.id)
    return done
  }

  const record = (
    bot: MainBot,
    sessionId: string,
    change: (current: MainActivity) => MainActivity,
  ) => {
    const entry = entryOf(bot.id)
    const write = (entry.writing ?? Promise.resolve())
      .then(() => deps.store.updateActivity(bot.id, sessionId, change))
      .catch((error: unknown) => {
        deps.warn(
          `bot-core: could not record the Main activity of bot "${bot.name}": ${messageOf(error)}`,
        )
      })
      .finally(() => {
        if (entry.writing === write) entry.writing = undefined
        poke(bot.id)
      })
    entry.writing = write
  }

  const evaluate = (botId: string) => {
    const entry = entryOf(botId)
    entry.timer?.()
    entry.timer = undefined
    if (disposed || entry.maintenance !== undefined || entry.inputs > 0) return
    if (entry.writing !== undefined) return
    const bot = deps.bot(botId)
    if (bot === undefined) return
    const decision = decide(bot, "tick")
    if (decision.kind === "wait") {
      if (decision.until !== undefined) {
        entry.timer = deps.later(Math.max(0, decision.until - deps.now()), () => {
          entry.timer = undefined
          evaluate(botId)
        })
      }
      return
    }
    if (!looksIdle(bot)) return
    void maintain(
      bot,
      decision.kind === "rotate"
        ? { kind: "rotate", reason: decision.reason }
        : { kind: "compact" },
      false,
    )
  }

  const poke = (botId: string) => {
    if (disposed) return
    const entry = entryOf(botId)
    if (entry.poked) return
    entry.poked = true
    deps.later(0, () => {
      entry.poked = false
      evaluate(botId)
    })
  }

  return {
    poke,
    pokeAll() {
      for (const bot of deps.bots()) poke(bot.id)
    },
    turnEnded(sessionId, at) {
      const bot = botOfMain(sessionId)
      if (bot === undefined) return
      const entry = entryOf(bot.id)
      entry.retryAt = undefined
      entry.failures = 0
      record(bot, sessionId, (current) => ({
        ...current,
        firstTurnAt: current.firstTurnAt ?? at,
        lastTurnAt: at,
      }))
    },
    compactionsCounted(sessionId, count) {
      const bot = botOfMain(sessionId)
      if (bot === undefined) return
      record(bot, sessionId, (current) =>
        current.compactions === count ? current : { ...current, compactions: count },
      )
    },
    async admit(botId, work) {
      const entry = entryOf(botId)
      for (;;) {
        if (entry.maintenance !== undefined) {
          await entry.maintenance.done
          continue
        }
        if (entry.writing !== undefined) {
          await entry.writing
          continue
        }
        const bot = deps.bot(botId)
        if (bot !== undefined && entry.inputs === 0 && !disposed) {
          const decision = decide(bot, "input")
          if (decision.kind === "rotate" && looksIdle(bot)) {
            await maintain(bot, { kind: "rotate", reason: decision.reason }, true)
            continue
          }
        }
        break
      }
      entry.inputs += 1
      try {
        return await work(deps.bot(botId)?.mainSessionId)
      } finally {
        entry.inputs -= 1
        if (entry.inputs === 0) poke(botId)
      }
    },
    async startNew(botId) {
      const bot = deps.bot(botId)
      if (bot === undefined) throw new Error(`bot "${botId}" does not exist`)
      const entry = entryOf(botId)
      if (entry.maintenance !== undefined || entry.inputs > 0) {
        return { outcome: "refused", reason: "busy", message: BUSY_MESSAGE }
      }
      if (activityOf(bot).lastTurnAt === undefined) return { outcome: "unchanged" }
      const result = await maintain(bot, { kind: "rotate", reason: "owner" }, false)
      return result.ok
        ? { outcome: "started", sessionId: result.sessionId }
        : { outcome: "refused", reason: result.reason, message: result.message }
    },
    maintenance(botId) {
      const current = entries.get(botId)?.maintenance
      if (current === undefined) return "idle"
      return current.kind === "rotate" ? "rotating" : "compacting"
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      for (const entry of entries.values()) entry.timer?.()
      listeners.clear()
    },
  }
}
