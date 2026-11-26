import type { Observable } from "../observable"

export interface ScopeBinding {
  readonly key?: unknown
}

export interface PendingInteraction {
  readonly key: string
  readonly kind: string
  readonly sessionId: string
}

export type PendingInteractionPublisher<T extends PendingInteraction> = (
  interaction: T,
  delegate: () => Promise<void>,
) => () => void

export interface UiSessionFace {
  readonly adapter: {
    readonly current: Observable<ScopeBinding>
  }
  registerPendingInteraction<T extends PendingInteraction>(
    precedence: (interaction: T) => number,
  ): PendingInteractionPublisher<T>
}
