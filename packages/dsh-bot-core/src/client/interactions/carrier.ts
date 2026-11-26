import type { Observable } from "../observable"
import type { PendingInteraction, PendingInteractionPublisher } from "../types"
import type { SessionInteractions } from "./session"

export const INTERACTION_CARRIER_KIND = "bot-core.interaction"

export interface InteractionCarrier extends PendingInteraction {
  readonly kind: typeof INTERACTION_CARRIER_KIND
  readonly interactionId: string
}

export function isInteractionCarrier(value: unknown): value is InteractionCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === INTERACTION_CARRIER_KIND
  )
}

export const INTERACTION_PRECEDENCE = 10

export function publishCarriers(
  followed: Observable<SessionInteractions | undefined>,
  publish: PendingInteractionPublisher<InteractionCarrier>,
): () => void {
  let withdraw: (() => void) | undefined
  let current: string | undefined
  let offModel: (() => void) | undefined
  let model: SessionInteractions | undefined

  const sync = () => {
    const state = model?.getSnapshot()
    const card = state?.status === "ready" ? state.cards[0] : undefined
    const key =
      model === undefined || card === undefined
        ? undefined
        : `bot-core:${model.sessionId}:${card.kind}:${card.interaction.id}`
    if (key === current) return
    withdraw?.()
    withdraw = undefined
    current = key
    if (model === undefined || card === undefined || key === undefined) return
    withdraw = publish(
      {
        key,
        kind: INTERACTION_CARRIER_KIND,
        sessionId: model.sessionId,
        interactionId: card.interaction.id,
      },
      async () => {},
    )
  }
  const follow = () => {
    const next = followed.getSnapshot()
    if (next === model) return
    offModel?.()
    model = next
    offModel = model?.subscribe(sync)
    sync()
  }
  follow()
  const off = followed.subscribe(follow)
  return () => {
    off()
    offModel?.()
    withdraw?.()
  }
}
