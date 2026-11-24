import type { BotEnvironmentCapacityState } from "../../shared/environment"
import {
  type BotEnvironmentNeed,
  type BotEnvironmentSpec,
  environmentCapacityShortfallText,
  initialEnvironmentSpec,
} from "../../shared/environment"
import type { EnvironmentKeeper } from "../environment"

export interface InitialSpecsDeps {
  readonly environment: Pick<EnvironmentKeeper, "current">
}

/** The spec a bot without one starts with, from what the registered environment can give it now. */
export interface InitialSpecs {
  /** What the environment accepts for the bot; the reason when it cannot be read. */
  capacity(botId: string): Promise<BotEnvironmentCapacityState>
  /**
   * `initialEnvironmentSpec` of the bot's capacity and `needs`.
   * @throws when no environment is registered, its capacity cannot be read, or it cannot give what is needed.
   */
  spec(botId: string, needs: readonly BotEnvironmentNeed[]): Promise<BotEnvironmentSpec>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createInitialSpecs(deps: InitialSpecsDeps): InitialSpecs {
  const read = async (botId: string) => {
    const env = deps.environment.current()
    if (env === undefined) throw new Error("no bot environment is registered")
    return env.capacity(botId)
  }
  return {
    async capacity(botId) {
      try {
        return { status: "ready", capacity: await read(botId) }
      } catch (error) {
        return { status: "unavailable", reason: messageOf(error) }
      }
    },
    async spec(botId, needs) {
      let capacity: Awaited<ReturnType<typeof read>>
      try {
        capacity = await read(botId)
      } catch (error) {
        throw new Error(`the capacity of the bot's VM could not be read: ${messageOf(error)}`)
      }
      const initial = initialEnvironmentSpec(capacity, needs)
      if (!initial.ok)
        throw new Error(initial.shortfalls.map(environmentCapacityShortfallText).join("; "))
      return initial.spec
    },
  }
}
