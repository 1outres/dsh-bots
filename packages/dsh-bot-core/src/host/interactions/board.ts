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

export interface InteractionPlace {
  readonly botId: string
  readonly sessionId: string
  readonly main: boolean
}

export type InteractionScope =
  | { readonly kind: "main"; readonly botId: string }
  | { readonly kind: "session"; readonly sessionId: string }

export interface InteractionResponder {
  answer(answer: BotInteractionAnswer): Promise<BotAnswerResult>
  hold?(): void
}

export interface OpenInteraction {
  readonly id: string
  readonly place: InteractionPlace
  update(interaction: BotInteraction): void
  respondWith(responder: InteractionResponder): void
  withdraw(): void
  isOpen(): boolean
}

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
  openIn(sessionId: string): readonly BotInteraction[]
  mainOf(botId: string): readonly BotInteraction[]
  closedIn(sessionId: string): readonly BotClosedInteraction[]
  subscribe(listener: () => void): () => void
  withdrawAll(): void
}

export interface InteractionBoardDeps {
  newId(): string
  publish(botId: string, output: BotChannelOutput): void
  opened(place: InteractionPlace, interaction: BotInteraction): void
}

export const KEPT_CLOSURES = 8

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
