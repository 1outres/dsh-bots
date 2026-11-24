import type { BotChannelOutput } from "../../channel-contract"
import {
  type BotAnswerOrigin,
  type BotAnswerResult,
  type BotClosedInteraction,
  type BotInteraction,
  type BotInteractionAnswer,
  type BotInteractionResolution,
  interactionAnswerProblem,
} from "../../shared/interactions"

/** Where an interaction waits: a bot's session, its Main or another. */
export interface InteractionPlace {
  readonly botId: string
  readonly sessionId: string
  /** The bot's Main session: its interactions also go to the bot's channels. */
  readonly main: boolean
}

/** Who may answer: a channel of the bot (its Main session's) or the browser showing a session. */
export type InteractionScope =
  | { readonly kind: "main"; readonly botId: string }
  | { readonly kind: "session"; readonly sessionId: string }

/** What the asker does with an answer the board checked against the interaction. */
export interface InteractionResponder {
  /** Deliver the answer to DSH; the board closes the interaction once it is accepted. */
  answer(answer: BotInteractionAnswer): Promise<BotAnswerResult>
  /** A person started answering; absent when nothing counts down. */
  hold?(): void
}

/** An interaction on the board, as its asker keeps it. */
export interface OpenInteraction {
  readonly id: string
  readonly place: InteractionPlace
  /** Replace the interaction (same id and kind), e.g. when its wait changes. */
  update(interaction: BotInteraction): void
  /** Answer it from now on through another responder. */
  respondWith(responder: InteractionResponder): void
  /** It ended without an answer through the board. */
  withdraw(): void
  isOpen(): boolean
}

/**
 * What waits for a person's decision in the bots' sessions: the one record the
 * browser and the channels present. The first answer accepted from anywhere
 * settles an interaction; everyone then learns who answered and what.
 * Interactions of a bot's Main session are also published to its channels.
 */
export interface InteractionBoard {
  open(
    place: InteractionPlace,
    interaction: (id: string) => BotInteraction,
    responder: InteractionResponder,
  ): OpenInteraction
  answer(
    scope: InteractionScope,
    interactionId: string,
    answer: BotInteractionAnswer,
    origin: BotAnswerOrigin,
  ): Promise<BotAnswerResult>
  hold(scope: InteractionScope, interactionId: string): BotAnswerResult
  /** A session's open interactions, in opening order. */
  openIn(sessionId: string): readonly BotInteraction[]
  /** The open interactions of a bot's Main session, in opening order. */
  mainOf(botId: string): readonly BotInteraction[]
  /** A session's latest closures, oldest first. */
  closedIn(sessionId: string): readonly BotClosedInteraction[]
  /** Called after every change. */
  subscribe(listener: () => void): () => void
  /** Withdraw every open interaction. */
  withdrawAll(): void
}

export interface InteractionBoardDeps {
  newId(): string
  publish(botId: string, output: BotChannelOutput): void
  /** An interaction opened in a session. */
  opened(place: InteractionPlace, interaction: BotInteraction): void
}

/** Closures a session keeps for the browser to show who answered. */
export const KEPT_CLOSURES = 8

/** Sessions whose closures are kept, the most recently closed in. */
export const KEPT_CLOSURE_SESSIONS = 64

interface Entry {
  readonly id: string
  readonly place: InteractionPlace
  interaction: BotInteraction
  responder: InteractionResponder
  delivering: boolean
}

const NOT_OPEN: BotAnswerResult = {
  accepted: false,
  reason: "not-open",
  message: "This is no longer waiting for an answer.",
}

const inScope = (place: InteractionPlace, scope: InteractionScope): boolean =>
  scope.kind === "main"
    ? place.main && place.botId === scope.botId
    : place.sessionId === scope.sessionId

export function createInteractionBoard(deps: InteractionBoardDeps): InteractionBoard {
  const open = new Map<string, Entry>()
  const closed = new Map<string, BotClosedInteraction[]>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }
  const toChannels = (entry: Entry, output: BotChannelOutput) => {
    if (entry.place.main) deps.publish(entry.place.botId, output)
  }

  const close = (entry: Entry, resolution: BotInteractionResolution) => {
    if (open.get(entry.id) !== entry) return
    open.delete(entry.id)
    const { sessionId } = entry.place
    const kept = [...(closed.get(sessionId) ?? []), { interaction: entry.interaction, resolution }]
    closed.delete(sessionId)
    closed.set(sessionId, kept.slice(-KEPT_CLOSURES))
    for (const oldest of [...closed.keys()].slice(0, -KEPT_CLOSURE_SESSIONS)) closed.delete(oldest)
    toChannels(entry, {
      kind: "interaction-closed",
      closure: { id: entry.id, kind: entry.interaction.kind, resolution },
    })
    changed()
  }

  const find = (scope: InteractionScope, id: string): Entry | undefined => {
    const entry = open.get(id)
    return entry !== undefined && inScope(entry.place, scope) ? entry : undefined
  }

  const openOf = (filter: (place: InteractionPlace) => boolean) =>
    [...open.values()].filter((entry) => filter(entry.place)).map((entry) => entry.interaction)

  return {
    open(place, interaction, responder) {
      let id = deps.newId()
      while (open.has(id)) id = deps.newId()
      const entry: Entry = {
        id,
        place,
        interaction: interaction(id),
        responder,
        delivering: false,
      }
      if (entry.interaction.id !== id) throw new Error("an interaction must carry its board id")
      open.set(id, entry)
      toChannels(entry, { kind: "interaction-opened", interaction: entry.interaction })
      deps.opened(place, entry.interaction)
      changed()
      return {
        id,
        place,
        update(next) {
          if (open.get(id) !== entry) return
          if (next.id !== id || next.kind !== entry.interaction.kind) {
            throw new Error(`interaction "${id}" cannot change its id or kind`)
          }
          entry.interaction = next
          toChannels(entry, { kind: "interaction-updated", interaction: next })
          changed()
        },
        respondWith(next) {
          entry.responder = next
        },
        withdraw: () => close(entry, { kind: "withdrawn" }),
        isOpen: () => open.get(id) === entry,
      }
    },
    async answer(scope, interactionId, answer, origin) {
      const entry = find(scope, interactionId)
      if (entry === undefined) return NOT_OPEN
      const problem = interactionAnswerProblem(entry.interaction, answer)
      if (problem !== undefined) return { accepted: false, reason: "invalid", message: problem }
      if (entry.delivering) {
        return {
          accepted: false,
          reason: "not-open",
          message: "Another answer is being delivered.",
        }
      }
      entry.delivering = true
      let result: BotAnswerResult
      try {
        result = await entry.responder.answer(answer)
      } catch (error) {
        result = {
          accepted: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        }
      } finally {
        entry.delivering = false
      }
      if (result.accepted) close(entry, { kind: "answered", by: origin, answer })
      return result
    },
    hold(scope, interactionId) {
      const entry = find(scope, interactionId)
      if (entry === undefined) return NOT_OPEN
      entry.responder.hold?.()
      return { accepted: true }
    },
    openIn: (sessionId) => openOf((place) => place.sessionId === sessionId),
    mainOf: (botId) => openOf((place) => place.main && place.botId === botId),
    closedIn: (sessionId) => closed.get(sessionId) ?? [],
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    withdrawAll() {
      for (const entry of [...open.values()]) close(entry, { kind: "withdrawn" })
    },
  }
}
