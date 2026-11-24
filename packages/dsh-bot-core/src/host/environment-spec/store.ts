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
  /** The specs table of ENVIRONMENT_SPECS_DOMAIN; only this store writes it. */
  readonly records: BotTable<EnvironmentSpecRecord>
  /** The queue the bot's connector settings are saved in, so neither check races the other. */
  readonly queue: SaveQueue
  /** What the bot's enabled connectors need of its environment, read inside the queue. */
  needs(botId: string): readonly BotEnvironmentNeed[]
  now(): number
}

/** How a bot stored before specs gets one. */
export interface AdoptedSpec {
  readonly origin: Exclude<EnvironmentSpecRecord["origin"], "configured">
  readonly spec: BotEnvironmentSpec
}

/** Each bot's environment spec: what its VM is made with. */
export interface EnvironmentSpecStore {
  /** Undefined for a bot stored before specs until {@link adopt}. */
  get(botId: string): BotEnvironmentSpec | undefined
  /** A new bot's spec (`initialEnvironmentSpec`). @throws when it has one. */
  create(botId: string, spec: BotEnvironmentSpec): Promise<void>
  /**
   * Give a bot stored before specs the spec its environment runs with
   * (`inspected`), or the initial one when it has no environment yet
   * (`default`). A bot with a spec keeps it.
   */
  adopt(botId: string, adopted: AdoptedSpec): Promise<void>
  /**
   * Replace the bot's spec.
   * @throws for a bot without one, or a change {@link environmentSpecProblems} refuses.
   */
  configure(
    botId: string,
    spec: BotEnvironmentSpec,
    capacity: BotEnvironmentCapacity,
  ): Promise<BotEnvironmentSpec>
  /** Delete one bot's spec (a creation rolled back). */
  discard(botId: string): Promise<void>
  /** Delete the specs of bots that no longer exist. */
  purge(exists: (botId: string) => boolean): Promise<void>
  /** Called with the bot id after its spec changed. */
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
