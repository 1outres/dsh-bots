import type {
  BotInteraction,
  BotInteractionResolution,
  BotInteractionsSnapshot,
} from "../../shared/interactions"

export type InteractionCard =
  | {
      readonly kind: "open"
      readonly interaction: BotInteraction
      readonly deadline?: number
    }
  | {
      readonly kind: "closed"
      readonly interaction: BotInteraction
      readonly resolution: BotInteractionResolution
      readonly channelName?: string
    }

export interface InteractionMemory {
  readonly seen: ReadonlySet<string>
  readonly dismissed: ReadonlySet<string>
}

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
