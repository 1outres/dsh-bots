/**
 * Creating and removing bots in the background, and what the browser sees of
 * both until they are done.
 *
 * Rules:
 * - A creation is accepted once its record is stored. Its environment, its
 *   preset and its Main session follow; the first of them that fails stops it
 *   and the failure is stored with the bot, which is then held (not prepared
 *   again, also across restarts) until the creation is retried or discarded.
 *   A creation stored before a restart continues by itself.
 * - A removal is accepted once the record is gone. Its sessions are archived
 *   and forgotten, and its environment removed (by the environment keeper,
 *   which retries with backoff); it is listed until both are done. A failed
 *   step is shown until it is retried or the removal is dismissed.
 */
import type {
  BotCreateInput,
  BotFailure,
  BotsSnapshot,
  CreationPhase,
  EnvironmentPhase,
  PendingBotView,
} from "../shared/bots"
import type { BotPresetState } from "../shared/preset"
import type { BotSessions } from "./cleanup"
import type { EnvironmentKeeper, EnvironmentStatus } from "./environment"
import type { SessionPreparations } from "./preparations"
import type { BotRegistry, CreatingBot, RemovalTarget, RemovedBot } from "./registry"

export interface BotLifecycleDeps {
  readonly registry: Pick<
    BotRegistry,
    | "list"
    | "creating"
    | "create"
    | "remove"
    | "forget"
    | "failCreation"
    | "retryCreation"
    | "repairMains"
    | "subscribe"
  >
  readonly environment: Pick<
    EnvironmentKeeper,
    "status" | "progress" | "removal" | "retry" | "retryRemoval" | "subscribe" | "onActivity"
  >
  readonly preset: {
    /** Recompose the bot's preset against the current environment; its state once settled. */
    settle(botId: string): Promise<BotPresetState | undefined>
    /** Whether the bot's preset is registered, so its Main can start. */
    registered(botId: string): boolean
  }
  readonly preparations: Pick<SessionPreparations, "ids" | "subscribe">
  /** Archive a removed bot's sessions (idempotent). */
  cleanup(bot: BotSessions): Promise<void>
  now(): number
  warn(message: string): void
}

export interface BotLifecycle {
  /** Listed bots, those being created or removed, and the sessions still being prepared. */
  snapshot(): BotsSnapshot
  /** @returns the new bot's id, once stored. */
  create(input: BotCreateInput): Promise<string>
  retryCreate(id: string): Promise<void>
  discardCreate(id: string): Promise<void>
  remove(id: string): Promise<void>
  retryRemove(id: string): Promise<void>
  dismissRemove(id: string): Promise<void>
  /** Called after the {@link snapshot} may have changed. */
  subscribe(listener: () => void): () => void
  dispose(): void
}

/** The step a creation is at, from what its parts report. */
export function creationPhase(
  bot: Pick<CreatingBot, "startingMain" | "failure">,
  environment: EnvironmentStatus,
  progress: EnvironmentPhase | undefined,
): CreationPhase {
  if (bot.failure !== undefined) return bot.failure.phase
  if (bot.startingMain) return "starting-main"
  if (environment.ready) return "preset"
  return progress ?? "queued"
}

type StepState =
  | { readonly state: "running" }
  | { readonly state: "done" }
  | { readonly state: "failed"; readonly failure: BotFailure }

interface Removal {
  readonly bot: RemovedBot
  startedAt: number
  sessions: StepState
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createBotLifecycle(deps: BotLifecycleDeps): BotLifecycle {
  const { registry, environment } = deps
  const listeners = new Set<() => void>()
  const attempts = new Map<string, number>()
  const removals = new Map<string, Removal>()
  const settling = new Set<string>()
  let disposed = false

  const publish = () => {
    for (const listener of [...listeners]) listener()
  }

  const creatingOf = (id: string) => registry.creating().find((bot) => bot.id === id)

  /** Every creation has the start of its current attempt: now, for one first seen. */
  const syncAttempts = () => {
    const ids = new Set<string>()
    for (const bot of registry.creating()) {
      ids.add(bot.id)
      if (!attempts.has(bot.id)) attempts.set(bot.id, deps.now())
    }
    for (const id of [...attempts.keys()]) if (!ids.has(id)) attempts.delete(id)
  }

  const fail = async (bot: CreatingBot, phase: CreationPhase, message: string) => {
    const stored = await registry.failCreation(bot.id, { phase, message, at: deps.now() })
    if (stored) deps.warn(`bot-core: creating bot "${bot.name}" (${bot.id}) failed: ${message}`)
  }

  /** Once the environment is ready: stop the creation when its preset cannot be registered. */
  const settlePreset = async (id: string) => {
    if (settling.has(id)) return
    settling.add(id)
    try {
      const state = await deps.preset.settle(id)
      const bot = creatingOf(id)
      if (disposed || bot === undefined || bot.failure !== undefined) return
      if (!environment.status(id).ready || state === undefined || state.ready) return
      if (state.pending !== true) await fail(bot, "preset", state.problem)
    } finally {
      settling.delete(id)
    }
  }

  /** Follow one creation after its environment changed. */
  const follow = (id: string) => {
    const bot = creatingOf(id)
    if (disposed || bot === undefined || bot.failure !== undefined) return
    const status = environment.status(id)
    if (!status.ready && status.pending !== true) {
      void fail(bot, creationPhase(bot, status, environment.progress(id)), status.problem)
    } else if (status.ready && !bot.startingMain) {
      void settlePreset(id).catch((error: unknown) => {
        deps.warn(`bot-core: could not settle the preset of bot "${id}": ${describe(error)}`)
      })
    }
  }

  const complete = (removal: Removal) => {
    if (removal.sessions.state !== "done" || environment.removal(removal.bot.id) !== undefined) {
      return
    }
    removals.delete(removal.bot.id)
  }

  const cleanSessions = async (removal: Removal) => {
    removal.sessions = { state: "running" }
    publish()
    try {
      await deps.cleanup(removal.bot)
      await registry.forget(removal.bot.sessionIds)
      removal.sessions = { state: "done" }
    } catch (error) {
      deps.warn(
        `bot-core: could not clean up the sessions of deleted bot "${removal.bot.name}": ${describe(error)}`,
      )
      removal.sessions = { state: "failed", failure: { message: describe(error), at: deps.now() } }
    }
    if (disposed || removals.get(removal.bot.id) !== removal) return
    complete(removal)
    publish()
  }

  const removalFailure = (removal: Removal): BotFailure | undefined => {
    if (removal.sessions.state === "failed") return removal.sessions.failure
    const status = environment.removal(removal.bot.id)
    return status?.state === "failed" ? { message: status.problem, at: status.at } : undefined
  }

  const removeBot = async (id: string, expected: RemovalTarget) => {
    let accepted: Removal | undefined
    await registry.remove(id, expected, (bot) => {
      accepted = { bot, startedAt: deps.now(), sessions: { state: "running" } }
      removals.set(id, accepted)
    })
    if (accepted !== undefined) void cleanSessions(accepted)
  }

  const requireRemoval = (id: string): Removal => {
    const removal = removals.get(id)
    if (removal === undefined) throw new Error(`bot "${id}" is not being removed`)
    if (removalFailure(removal) === undefined) {
      throw new Error(`the removal of bot "${removal.bot.name}" has not failed`)
    }
    return removal
  }

  const creatingView = (bot: CreatingBot): PendingBotView => {
    const startedAt = attempts.get(bot.id)
    if (startedAt === undefined) throw new Error(`bot "${bot.id}" has no creation attempt`)
    return {
      id: bot.id,
      name: bot.name,
      avatar: bot.avatar,
      operation: {
        kind: "create",
        phase: creationPhase(bot, environment.status(bot.id), environment.progress(bot.id)),
      },
      startedAt,
      ...(bot.failure === undefined
        ? {}
        : { failure: { message: bot.failure.message, at: bot.failure.at } }),
      sessionIds: bot.sessionIds,
      createdAt: bot.createdAt,
    }
  }

  const removalView = (removal: Removal): PendingBotView => {
    const failure = removalFailure(removal)
    const { bot } = removal
    const sessionIds = new Set(bot.sessionIds)
    if (bot.mainSessionId !== undefined) sessionIds.add(bot.mainSessionId)
    return {
      id: bot.id,
      name: bot.name,
      avatar: bot.avatar,
      operation: { kind: "remove" },
      startedAt: removal.startedAt,
      ...(failure === undefined ? {} : { failure }),
      sessionIds: [...sessionIds],
      createdAt: bot.createdAt,
    }
  }

  syncAttempts()
  const offs = [
    registry.subscribe(() => {
      syncAttempts()
      publish()
    }),
    environment.subscribe((id) => {
      follow(id)
      publish()
    }),
    environment.onActivity((id) => {
      const removal = removals.get(id)
      if (removal !== undefined) complete(removal)
      publish()
    }),
    deps.preparations.subscribe(publish),
  ]
  for (const bot of registry.creating()) follow(bot.id)

  return {
    snapshot() {
      const pending = [
        ...registry.creating().map(creatingView),
        ...[...removals.values()].map(removalView),
      ].sort((left, right) => left.createdAt - right.createdAt)
      return { bots: registry.list(), pending, preparingSessionIds: deps.preparations.ids() }
    },
    create: (input) => registry.create(input),
    async retryCreate(id) {
      await registry.retryCreation(id)
      attempts.set(id, deps.now())
      publish()
      environment.retry(id)
      if (deps.preset.registered(id)) {
        registry.repairMains([id]).catch((error: unknown) => {
          deps.warn(`bot-core: could not start the Main session of bot "${id}": ${describe(error)}`)
        })
      }
    },
    discardCreate: (id) => removeBot(id, "creating"),
    remove: (id) => removeBot(id, "listed"),
    async retryRemove(id) {
      const removal = requireRemoval(id)
      removal.startedAt = deps.now()
      environment.retryRemoval(id)
      if (removal.sessions.state === "failed") void cleanSessions(removal)
      else publish()
    },
    async dismissRemove(id) {
      requireRemoval(id)
      removals.delete(id)
      publish()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      for (const off of offs) off()
      listeners.clear()
    },
  }
}
