import type {
  BotAnswerResult,
  BotInteractionAnswer,
  BotInteractionsSnapshot,
} from "../../shared/interactions"
import { createStore, type Observable } from "../observable"
import type { BotInteractionsRemote, RemoteMount } from "../remote"
import { cardsOf, type InteractionCard } from "./view"

/** A bot session's interactions as this page follows them. */
export type SessionInteractionsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly cards: readonly InteractionCard[] }
  | { readonly status: "failed"; readonly message: string }

export interface SessionInteractions extends Observable<SessionInteractionsState> {
  readonly sessionId: string
  /** Answer from this page; its closure is not shown here. */
  answer(interactionId: string, answer: BotInteractionAnswer): Promise<BotAnswerResult>
  /** The person started answering a timed question batch. */
  hold(interactionId: string): void
  /** Put a closure away. */
  dismiss(interactionId: string): void
  dispose(): void
}

export interface SessionInteractionsDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
  readonly now: () => number
}

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function pause(ms: number, generation: Observable<object | undefined>, since: object | undefined) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, ms)
    const off = generation.subscribe(() => {
      const current = generation.getSnapshot()
      if (current !== undefined && current !== since) done()
    })
  })
}

const refusal = (message: string): BotAnswerResult => ({
  accepted: false,
  reason: "failed",
  message,
})

/**
 * Follow one bot session's interactions through `remote.botInteractions`,
 * reconnecting with backoff (or at once on a new connection generation); the
 * last cards stay while it reconnects.
 */
export function followSessionInteractions(
  deps: SessionInteractionsDeps,
  sessionId: string,
): SessionInteractions {
  const state = createStore<SessionInteractionsState>({ status: "loading" })
  const seen = new Set<string>()
  const dismissed = new Set<string>()
  let last: { readonly snapshot: BotInteractionsSnapshot; readonly receivedAt: number } | undefined
  let disposed = false
  let stop: (() => void) | undefined
  let face: BotInteractionsRemote | undefined

  const publish = () => {
    if (last === undefined) return
    for (const { interaction } of last.snapshot.open) seen.add(interaction.id)
    state.set({
      status: "ready",
      cards: cardsOf(last.snapshot, { seen, dismissed }, last.receivedAt),
    })
  }

  const follow = async (remote: BotInteractionsRemote) => {
    let backoff = BASE_DELAY_MS
    while (!disposed) {
      const attempt = deps.generation.getSnapshot()
      let failure: string | undefined
      try {
        const handle = remote.watch(sessionId)
        stop = () => handle.dispose()
        for await (const snapshot of handle) {
          if (disposed) return
          backoff = BASE_DELAY_MS
          last = { snapshot, receivedAt: deps.now() }
          publish()
        }
      } catch (error) {
        failure = messageOf(error)
      } finally {
        stop = undefined
      }
      if (disposed) return
      if (last === undefined && failure !== undefined)
        state.set({ status: "failed", message: failure })
      await pause(backoff, deps.generation, attempt)
      backoff = Math.min(backoff * 2, MAX_DELAY_MS)
    }
  }

  void deps.mount.then((mounted) => {
    if (disposed) return
    if (mounted.status === "failed") {
      state.set({ status: "failed", message: mounted.error })
      return
    }
    face = mounted.remote.botInteractions
    return follow(face)
  })

  return {
    sessionId,
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async answer(interactionId, answer) {
      if (face === undefined) return refusal("The interactions are not connected yet.")
      dismissed.add(interactionId)
      try {
        const result = await face.answer(sessionId, interactionId, answer)
        if (result.ok && result.value.accepted) return result.value
        dismissed.delete(interactionId)
        return result.ok ? result.value : refusal(result.error.message ?? "The answer was refused.")
      } catch (error) {
        dismissed.delete(interactionId)
        return refusal(messageOf(error))
      } finally {
        publish()
      }
    },
    hold(interactionId) {
      face?.hold(sessionId, interactionId).catch((error: unknown) => {
        console.warn(`bot-core: could not hold interaction "${interactionId}": ${messageOf(error)}`)
      })
    },
    dismiss(interactionId) {
      dismissed.add(interactionId)
      publish()
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
