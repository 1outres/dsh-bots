import {
  type BotEnvironmentCapacity,
  type BotEnvironmentNeed,
  type BotEnvironmentSpec,
  environmentSpecProblems,
  environmentSpecRefusal,
} from "../../shared/environment"
import type { BotTable } from "../registry"
import type { SaveQueue } from "../save-queue"
import type { EnvironmentSpecRecord } from "./domain"

export interface EnvironmentSpecStoreDeps {
  readonly records: BotTable<EnvironmentSpecRecord>
  readonly queue: SaveQueue
  needs(botId: string): readonly BotEnvironmentNeed[]
  now(): number
}

export interface AdoptedSpec {
  readonly origin: Exclude<EnvironmentSpecRecord["origin"], "configured">
  readonly spec: BotEnvironmentSpec
}

export interface EnvironmentSpecStore {
  get(botId: string): BotEnvironmentSpec | undefined
  create(botId: string, spec: BotEnvironmentSpec): Promise<void>
  adopt(botId: string, adopted: AdoptedSpec): Promise<void>
  configure(
    botId: string,
    spec: BotEnvironmentSpec,
    capacity: BotEnvironmentCapacity,
  ): Promise<BotEnvironmentSpec>
  discard(botId: string): Promise<void>
  purge(exists: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

export function createEnvironmentSpecStore(deps: EnvironmentSpecStoreDeps): EnvironmentSpecStore {
  const { records, queue } = deps
  const listeners = new Set<(botId: string) => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const put = async (
    botId: string,
    spec: BotEnvironmentSpec,
    origin: EnvironmentSpecRecord["origin"],
  ) => {
    await records.put(botId, { spec: { ...spec }, origin, updatedAt: deps.now() })
    publish(botId)
  }
  return {
    get: (botId) => records.get(botId)?.spec,
    create(botId, spec) {
      return queue(async () => {
        if (records.get(botId) !== undefined) throw new Error(`bot "${botId}" already has a spec`)
        await put(botId, spec, "default")
      })
    },
    adopt(botId, adopted) {
      return queue(async () => {
        if (records.get(botId) !== undefined) return
        await put(botId, adopted.spec, adopted.origin)
      })
    },
    configure(botId, spec, capacity) {
      return queue(async () => {
        const current = records.get(botId)?.spec
        if (current === undefined) {
          throw new Error(
            "the bot's VM spec is not read yet; it is read once its environment is ready",
          )
        }
        const problems = environmentSpecProblems(current, spec, capacity, deps.needs(botId))
        if (problems.length > 0) throw new Error(problems.map(environmentSpecRefusal).join("; "))
        await put(botId, spec, "configured")
        return spec
      })
    },
    discard(botId) {
      return queue(async () => {
        if (records.get(botId) === undefined) return
        await records.delete(botId)
        publish(botId)
      })
    },
    purge(exists) {
      return queue(async () => {
        for (const [botId] of [...records.entries()]) {
          if (exists(botId)) continue
          await records.delete(botId)
          publish(botId)
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
