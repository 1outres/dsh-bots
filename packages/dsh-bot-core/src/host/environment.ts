import type { BotEnvironment, BotEnvironmentBot, BotEnvironmentTarget } from "../contract"
import type { EnvironmentPhase } from "../shared/bots"
import type { BotEnvironmentSpec } from "../shared/environment"
import type { EnvironmentLayer } from "./preset/types"

export type EnvironmentStatus =
  | { readonly ready: true }
  | {
      readonly ready: false
      readonly problem: string
      readonly pending?: true
    }

export type RemovalStatus =
  | { readonly state: "running" }
  | { readonly state: "failed"; readonly problem: string; readonly at: number }

export interface EnvironmentKeeperDeps {
  target(botId: string): BotEnvironmentBot | undefined
  spec(botId: string): BotEnvironmentSpec | undefined
  adopt(botId: string, inspected: BotEnvironmentSpec | undefined): Promise<void>
  botIds(): Iterable<string>
  held(botId: string): boolean
  release(botId: string): Promise<unknown>
  later(work: () => void, ms: number): () => void
  now(): number
  warn(message: string): void
  retryMs?: number
  maxRetryMs?: number
  acceptedId?: string | undefined
  graceMs?: number
}

export interface EnvironmentKeeper {
  register(environment: BotEnvironment): () => void
  current(): BotEnvironment | undefined
  layer(bot: BotEnvironmentBot): EnvironmentLayer | undefined
  ensured(botId: string): BotEnvironmentTarget | undefined
  reconcile(botId: string): void
  status(botId: string): EnvironmentStatus
  progress(botId: string): EnvironmentPhase | undefined
  removal(botId: string): RemovalStatus | undefined
  retry(botId: string): void
  retryRemoval(botId: string): void
  sync(): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
  onActivity(listener: (botId: string) => void): () => void
  onRegistration(listener: () => void): () => void
  dispose(): void
}

interface Tracked {
  status: EnvironmentStatus
  controller?: AbortController | undefined
  cancelRetry?: (() => void) | undefined
  failures: number
  warned?: string | undefined
  progress?: EnvironmentPhase | undefined
  ensured?: BotEnvironmentTarget | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NO_ENVIRONMENT: EnvironmentStatus = {
  ready: false,
  problem: "no bot environment is registered (bots run only inside one)",
  pending: true,
}

export function workspaceProblem(workspace: unknown): string | undefined {
  if (typeof workspace !== "string" || !workspace.startsWith("/")) {
    return "its workspace must be an absolute path"
  }
  const parts = workspace.split("/").slice(1)
  const normalized =
    workspace === "/" || parts.every((part) => part !== "" && part !== "." && part !== "..")
  return normalized && !workspace.includes("\0")
    ? undefined
    : `its workspace ${JSON.stringify(workspace)} is not a normalized path`
}

export function createEnvironmentKeeper(deps: EnvironmentKeeperDeps): EnvironmentKeeper {
  const retryMs = deps.retryMs ?? 5_000
  const maxRetryMs = deps.maxRetryMs ?? 300_000
  const backoff = (failures: number) => Math.min(retryMs * 2 ** (failures - 1), maxRetryMs)
  const tracked = new Map<string, Tracked>()
  const removals = new Map<string, () => void>()
  const orphans = new Set<string>()
  const listeners = new Set<(botId: string) => void>()
  const activityListeners = new Set<(botId: string) => void>()
  const registrationListeners = new Set<() => void>()
  const registrationChanged = () => {
    for (const listener of [...registrationListeners]) {
      try {
        listener()
      } catch (error) {
        deps.warn(`bot-core: an environment registration listener failed: ${describe(error)}`)
      }
    }
  }
  const removalStates = new Map<string, RemovalStatus>()
  let environment: BotEnvironment | undefined
  let offChange: (() => void) | undefined
  let closed = false

  const notify = (botId: string) => {
    for (const listener of [...listeners]) {
      try {
        listener(botId)
      } catch (error) {
        deps.warn(`bot-core: an environment listener failed for "${botId}": ${describe(error)}`)
      }
    }
  }

  const announce = (botId: string) => {
    for (const listener of [...activityListeners]) {
      try {
        listener(botId)
      } catch (error) {
        deps.warn(
          `bot-core: an environment activity listener failed for "${botId}": ${describe(error)}`,
        )
      }
    }
  }

  const setRemoval = (botId: string, status: RemovalStatus | undefined) => {
    if (status === undefined) removalStates.delete(botId)
    else removalStates.set(botId, status)
    announce(botId)
  }

  const resolveTarget = async (
    env: BotEnvironment,
    bot: BotEnvironmentBot,
    signal: AbortSignal,
  ): Promise<BotEnvironmentTarget> => {
    if (deps.spec(bot.id) === undefined) {
      const inspected = await env.inspect(bot.id, signal)
      signal.throwIfAborted()
      await deps.adopt(bot.id, inspected)
    }
    const spec = deps.spec(bot.id)
    if (spec === undefined) throw new Error("the bot has no spec")
    return { id: bot.id, name: bot.name, spec }
  }

  const setStatus = (botId: string, entry: Tracked, status: EnvironmentStatus) => {
    const changed = JSON.stringify(entry.status) !== JSON.stringify(status)
    entry.status = status
    if (!status.ready) entry.ensured = undefined
    if (changed) notify(botId)
  }

  const halt = (entry: Tracked) => {
    entry.controller?.abort()
    entry.controller = undefined
    entry.cancelRetry?.()
    entry.cancelRetry = undefined
  }

  const preparing = (env: BotEnvironment): EnvironmentStatus => ({
    ready: false,
    problem: `the bot's environment ("${env.id}") is being prepared`,
    pending: true,
  })

  const start = (botId: string) => {
    const entry = tracked.get(botId)
    const env = environment
    if (closed || entry === undefined || env === undefined) return
    const bot = deps.target(botId)
    if (bot === undefined || deps.held(botId)) return
    halt(entry)
    const controller = new AbortController()
    entry.controller = controller
    if (entry.progress !== undefined) {
      entry.progress = undefined
      announce(botId)
    }
    if (!entry.status.ready && entry.status.pending === true) {
      setStatus(botId, entry, preparing(env))
    }
    const current = () =>
      !closed &&
      !controller.signal.aborted &&
      environment === env &&
      tracked.get(botId) === entry &&
      entry.controller === controller
    const progress = (phase: EnvironmentPhase) => {
      if (!current() || entry.progress === phase) return
      entry.progress = phase
      announce(botId)
    }
    let target: BotEnvironmentTarget | undefined
    Promise.resolve()
      .then(async () => {
        target = await resolveTarget(env, bot, controller.signal)
        await env.ensure(target, { signal: controller.signal, progress })
      })
      .then(
        () => {
          if (!current()) return
          entry.controller = undefined
          entry.failures = 0
          entry.warned = undefined
          entry.ensured = target
          entry.status = { ready: true }
          notify(botId)
        },
        (error: unknown) => {
          if (!current()) return
          entry.controller = undefined
          entry.failures += 1
          const delay = backoff(entry.failures)
          const problem = `the bot's environment ("${env.id}") could not be prepared: ${describe(error)}`
          if (entry.warned !== problem) {
            entry.warned = problem
            deps.warn(
              `bot-core: ${problem} (bot "${botId}"); retrying with backoff (next in ${Math.round(delay / 1000)} s)`,
            )
          }
          if (!deps.held(botId)) {
            entry.cancelRetry = deps.later(() => {
              entry.cancelRetry = undefined
              start(botId)
            }, delay)
          }
          setStatus(botId, entry, { ready: false, problem })
        },
      )
  }

  const orphan = (botId: string) => {
    orphans.add(botId)
    setRemoval(botId, {
      state: "failed",
      problem:
        "no bot environment is registered; the bot's environment is removed once one is registered again",
      at: deps.now(),
    })
  }

  const removalFailures = new Map<string, number>()

  const remove = (botId: string, failures = 0, scheduled = false): Promise<void> => {
    removals.get(botId)?.()
    removals.delete(botId)
    const env = environment
    if (closed) return Promise.resolve()
    if (env === undefined) {
      orphan(botId)
      return Promise.resolve()
    }
    orphans.delete(botId)
    if (!scheduled) setRemoval(botId, { state: "running" })
    return Promise.resolve()
      .then(() => env.remove(botId))
      .then(
        () => {
          removalFailures.delete(botId)
          if (!closed) setRemoval(botId, undefined)
        },
        (error: unknown) => {
          if (closed) return
          if (environment !== env) {
            orphan(botId)
            return
          }
          const delay = backoff(failures + 1)
          if (failures === 0) {
            deps.warn(
              `bot-core: could not remove the environment ("${env.id}") of deleted bot "${botId}"; retrying with backoff: ${describe(error)}`,
            )
          }
          removalFailures.set(botId, failures + 1)
          const cancel = deps.later(() => {
            removals.delete(botId)
            void remove(botId, failures + 1, true)
          }, delay)
          removals.set(botId, cancel)
          const problem = `the bot's environment ("${env.id}") could not be removed: ${describe(error)}`
          const shown = removalStates.get(botId)
          if (shown?.state !== "failed" || shown.problem !== problem) {
            setRemoval(botId, { state: "failed", problem, at: deps.now() })
          }
        },
      )
  }

  const drop = async (botId: string) => {
    const entry = tracked.get(botId)
    if (entry === undefined) return
    halt(entry)
    tracked.delete(botId)
    setRemoval(botId, { state: "running" })
    try {
      await deps.release(botId)
    } catch (error) {
      deps.warn(
        `bot-core: could not release the preset of deleted bot "${botId}": ${describe(error)}`,
      )
    }
    if (!closed) await remove(botId, removalFailures.get(botId) ?? 0)
  }

  const sync = async () => {
    if (closed) return
    const stored = new Set(deps.botIds())
    for (const botId of stored) {
      if (tracked.has(botId)) continue
      tracked.set(botId, { status: NO_ENVIRONMENT, failures: 0 })
      start(botId)
    }
    await Promise.all([...tracked.keys()].filter((id) => !stored.has(id)).map(drop))
  }

  const cancelGrace = deps.later(() => {
    if (!closed && environment === undefined && tracked.size > 0) {
      deps.warn(
        "bot-core: no bot environment is registered, so no bot can run (their presets stay unregistered); enable the plugin that provides it",
      )
    }
  }, deps.graceMs ?? 30_000)

  return {
    register(next) {
      if (closed) throw new Error("bot-core is unloading")
      if (deps.acceptedId !== undefined && next.id !== deps.acceptedId) {
        throw new Error(
          `bot environment "${next.id}" is not accepted: bot-core's config names "${deps.acceptedId}" (environment)`,
        )
      }
      if (environment !== undefined) {
        throw new Error(`a bot environment ("${environment.id}") is already registered`)
      }
      const problem = workspaceProblem(next.workspace)
      if (problem !== undefined) {
        throw new Error(`bot environment "${next.id}" is not accepted: ${problem}`)
      }
      environment = next
      try {
        offChange = next.onChange?.((botId) => {
          if (environment === next && tracked.has(botId)) start(botId)
        })
      } catch (error) {
        environment = undefined
        throw error
      }
      for (const botId of [...orphans]) void remove(botId)
      for (const botId of tracked.keys()) start(botId)
      void sync()
      registrationChanged()
      return () => {
        if (environment !== next) return
        environment = undefined
        const off = offChange
        offChange = undefined
        try {
          off?.()
        } catch (error) {
          deps.warn(`bot-core: could not stop observing the environment: ${describe(error)}`)
        }
        for (const [botId, cancel] of removals) {
          cancel()
          orphan(botId)
        }
        removals.clear()
        for (const [botId, entry] of tracked) {
          halt(entry)
          entry.failures = 0
          entry.warned = undefined
          setStatus(botId, entry, NO_ENVIRONMENT)
        }
        registrationChanged()
      }
    },

    current: () => environment,

    layer(bot) {
      const env = environment
      if (env === undefined) return undefined
      return { id: env.id, isolate: env.isolate, rows: env.rows({ id: bot.id, name: bot.name }) }
    },

    ensured: (botId) => {
      const entry = tracked.get(botId)
      return entry?.status.ready === true ? entry.ensured : undefined
    },

    reconcile(botId) {
      if (closed || !tracked.has(botId)) return
      start(botId)
    },

    status(botId) {
      if (environment === undefined) return NO_ENVIRONMENT
      return tracked.get(botId)?.status ?? preparing(environment)
    },

    progress: (botId) => tracked.get(botId)?.progress,

    removal: (botId) => removalStates.get(botId),

    retry(botId) {
      const entry = tracked.get(botId)
      const env = environment
      if (closed || entry === undefined) return
      halt(entry)
      entry.failures = 0
      entry.warned = undefined
      if (env !== undefined && !entry.status.ready) setStatus(botId, entry, preparing(env))
      start(botId)
    },

    retryRemoval(botId) {
      if (closed || removalStates.get(botId)?.state !== "failed" || orphans.has(botId)) return
      void remove(botId, removalFailures.get(botId) ?? 0)
    },

    sync,

    subscribe(listener) {
      const entry = (botId: string) => listener(botId)
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },

    onRegistration(listener) {
      registrationListeners.add(listener)
      return () => {
        registrationListeners.delete(listener)
      }
    },

    onActivity(listener) {
      const entry = (botId: string) => listener(botId)
      activityListeners.add(entry)
      return () => {
        activityListeners.delete(entry)
      }
    },

    dispose() {
      if (closed) return
      closed = true
      cancelGrace()
      for (const entry of tracked.values()) halt(entry)
      for (const cancel of removals.values()) cancel()
      removals.clear()
      try {
        offChange?.()
      } catch {}
      offChange = undefined
      listeners.clear()
      registrationListeners.clear()
      activityListeners.clear()
    },
  }
}
