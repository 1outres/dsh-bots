import type {
  BotInteraction,
  BotInteractionResolution,
  BotInteractionsSnapshot,
} from "../../shared/interactions"

/** One card the composer seat shows for a bot session. */
export type InteractionCard =
  | {
      readonly kind: "open"
      readonly interaction: BotInteraction
      /** This page's clock: when a counting wait ends. */
      readonly deadline?: number
    }
  | {
      readonly kind: "closed"
      readonly interaction: BotInteraction
      readonly resolution: BotInteractionResolution
      /** The answering channel's name, when a channel answered. */
      readonly channelName?: string
    }

/** What this page remembers of a session's interactions. */
export interface InteractionMemory {
  /** Interactions this page showed open. */
  readonly seen: ReadonlySet<string>
  /** Closures the person put away, and interactions answered from this page. */
  readonly dismissed: ReadonlySet<string>
}

/**
 * The cards of a session, open ones first: a closure shows (who answered,
 * or that it was withdrawn) only for an interaction this page showed open and
 * did not answer itself, until it is put away.
 */
export function cardsOf(
  snapshot: BotInteractionsSnapshot,
  memory: InteractionMemory,
  receivedAt: number,
): readonly InteractionCard[] {
  const open: InteractionCard[] = snapshot.open.map(({ interaction, remainingMs }) => ({
    kind: "open",
    interaction,
    ...(remainingMs === undefined ? {} : { deadline: receivedAt + remainingMs }),
  }))
  const closed: InteractionCard[] = snapshot.closed
    .filter(
      ({ interaction }) => memory.seen.has(interaction.id) && !memory.dismissed.has(interaction.id),
    )
    .map(({ interaction, resolution }) => {
      const channelId =
        resolution.kind === "answered" && resolution.by.via === "channel"
          ? resolution.by.channelId
          : undefined
      const channelName = channelId === undefined ? undefined : snapshot.channelNames[channelId]
      return {
        kind: "closed",
        interaction,
        resolution,
        ...(channelName === undefined ? {} : { channelName }),
      }
    })
  return [...open, ...closed.reverse()]
}
