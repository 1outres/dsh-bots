import type { BotReply } from "../../channel-contract"
import {
  type HeldQueue,
  offered,
  type Released,
  type SilencerOutcome,
  settled,
  spokenOf,
} from "./held-queue"

export interface HeldReplies {
  offer(
    sessionId: string,
    turn: number,
    reply: BotReply,
    silencers: readonly string[],
  ): readonly BotReply[]
  settle(sessionId: string, turn: number, outcome: SilencerOutcome): readonly BotReply[]
  flush(sessionId: string, turn: number): readonly BotReply[]
  forget(sessionId: string): void
}

interface HeldTurn {
  readonly turn: number
  readonly queue: HeldQueue<BotReply>
}

export function createHeldReplies(): HeldReplies {
  const turns = new Map<string, HeldTurn>()
  const turnOf = (sessionId: string, turn: number): HeldTurn | undefined => {
    const current = turns.get(sessionId)
    return current !== undefined && current.turn === turn ? current : undefined
  }
  const keep = (sessionId: string, turn: number, { queue, spoken }: Released<BotReply>) => {
    if (queue.length === 0) turns.delete(sessionId)
    else turns.set(sessionId, { turn, queue })
    return spoken
  }
  return {
    offer: (sessionId, turn, reply, silencers) =>
      keep(sessionId, turn, offered(turnOf(sessionId, turn)?.queue ?? [], reply, silencers)),
    settle(sessionId, turn, outcome) {
      const current = turnOf(sessionId, turn)
      return current === undefined ? [] : keep(sessionId, turn, settled(current.queue, outcome))
    },
    flush(sessionId, turn) {
      const current = turnOf(sessionId, turn)
      if (current === undefined) return []
      turns.delete(sessionId)
      return spokenOf(current.queue)
    },
    forget(sessionId) {
      turns.delete(sessionId)
    },
  }
}
