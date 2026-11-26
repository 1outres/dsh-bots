import {
  type BotEnvironmentApplication,
  type BotEnvironmentCapacityState,
  type BotEnvironmentNeed,
  type BotEnvironmentView,
  parseEnvironmentSpec,
  sameEnvironmentSpec,
} from "../../shared/environment"
import type { EnvironmentKeeper } from "../environment"
import type { EnvironmentSpecStore } from "./store"

export interface EnvironmentPanelDeps {
  readonly store: EnvironmentSpecStore
  readonly environment: Pick<EnvironmentKeeper, "current" | "status" | "ensured" | "progress">
  needs(botId: string): readonly BotEnvironmentNeed[]
  listed(botId: string): boolean
}

export interface EnvironmentPanel {
  view(botId: string): BotEnvironmentView
  refresh(botId: string): Promise<void>
  configure(botId: string, spec: unknown): Promise<BotEnvironmentView>
  subscribe(listener: () => void): () => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const NO_ENVIRONMENT = {
  status: "unavailable",
  reason: "no bot environment is registered",
} as const satisfies BotEnvironmentCapacityState

export function createEnvironmentPanel(deps: EnvironmentPanelDeps): EnvironmentPanel {
  const listeners = new Set<() => void>()
  const capacities = new Map<string, BotEnvironmentCapacityState>()
  const setCapacity = (botId: string, next: BotEnvironmentCapacityState) => {
    if (JSON.stringify(next) === JSON.stringify(capacities.get(botId))) return
    capacities.set(botId, next)
    for (const listener of [...listeners]) listener()
  }
  const read = async (botId: string) => {
    const env = deps.environment.current()
    if (env === undefined) {
      setCapacity(botId, NO_ENVIRONMENT)
      throw new Error(NO_ENVIRONMENT.reason)
    }
    try {
      const read = await env.capacity(botId)
      setCapacity(botId, { status: "ready", capacity: read })
      return read
    } catch (error) {
      setCapacity(botId, { status: "unavailable", reason: messageOf(error) })
      throw error
    }
  }

  const application = (botId: string): BotEnvironmentApplication => {
    const spec = deps.store.get(botId)
    const status = deps.environment.status(botId)
    if (spec === undefined) {
      return {
        state: "unread",
        reason: status.ready ? "the bot's environment is being read" : status.problem,
      }
    }
    const ensured = deps.environment.ensured(botId)
    if (status.ready && ensured !== undefined && sameEnvironmentSpec(ensured.spec, spec)) {
      return { state: "applied" }
    }
    if (!status.ready && status.pending !== true) return { state: "failed", reason: status.problem }
    const phase = deps.environment.progress(botId)
    return phase === undefined ? { state: "applying" } : { state: "applying", phase }
  }

  const view = (botId: string): BotEnvironmentView => {
    if (!deps.listed(botId)) throw new Error(`bot "${botId}" does not exist`)
    const spec = deps.store.get(botId)
    return {
      botId,
      ...(spec === undefined ? {} : { spec }),
      capacity: capacities.get(botId) ?? NO_ENVIRONMENT,
      needs: deps.needs(botId),
      application: application(botId),
    }
  }

  return {
    view,
    async refresh(botId) {
      try {
        await read(botId)
      } catch {}
    },
    async configure(botId, input) {
      view(botId)
      const spec = parseEnvironmentSpec(input)
      await deps.store.configure(botId, spec, await read(botId))
      return view(botId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
