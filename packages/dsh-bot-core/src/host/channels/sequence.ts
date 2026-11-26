import type { BotChannelOutput } from "../../channel-contract"

type Step =
  | { readonly kind: "output"; readonly output: BotChannelOutput }
  | { readonly kind: "work"; readonly run: () => Promise<void> }

export interface ChannelSequence {
  publish(botId: string, output: BotChannelOutput): void
  run(botId: string, work: () => Promise<void>): void
}

export interface ChannelSequenceDeps {
  publish(botId: string, output: BotChannelOutput): void
  warn(message: string): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createChannelSequence(deps: ChannelSequenceDeps): ChannelSequence {
  const queues = new Map<string, Step[]>()

  const drain = (botId: string, queue: Step[]) => {
    for (let step = queue[0]; step !== undefined; step = queue[0]) {
      if (step.kind === "work") {
        step
          .run()
          .catch((error: unknown) => {
            deps.warn(`bot-core: channel work of bot "${botId}" failed: ${messageOf(error)}`)
          })
          .finally(() => {
            queue.shift()
            drain(botId, queue)
          })
        return
      }
      queue.shift()
      deps.publish(botId, step.output)
    }
    queues.delete(botId)
  }

  const push = (botId: string, step: Step) => {
    const pending = queues.get(botId)
    if (pending !== undefined) {
      pending.push(step)
      return
    }
    const queue = [step]
    queues.set(botId, queue)
    drain(botId, queue)
  }

  return {
    publish: (botId, output) => push(botId, { kind: "output", output }),
    run: (botId, work) => push(botId, { kind: "work", run: work }),
  }
}
