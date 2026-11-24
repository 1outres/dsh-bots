// Source: dsh-client-ui-session/src/client/index.ts (`SlotScopeAdapter`, `registerPendingInteraction`).
import type { Observable } from "../observable"

/** The binding value of a Slot scope adapter: `key` is the bound session's id. */
export interface ScopeBinding {
  readonly key?: unknown
}

/** `SessionPendingInteractionBase`: what waits for the user in one session. */
export interface PendingInteraction {
  readonly key: string
  readonly kind: string
  readonly sessionId: string
}

/** `PendingInteractionPublisher`: publish one; the returned function withdraws it. */
export type PendingInteractionPublisher<T extends PendingInteraction> = (
  interaction: T,
  delegate: () => Promise<void>,
) => () => void

/** `ctx.uiSession`: the renderer-facing scope adapter and the pending-interaction registry. */
export interface UiSessionFace {
  readonly adapter: {
    readonly current: Observable<ScopeBinding>
  }
  /** Register a domain; per session the highest precedence (the latest among equals) wins the composer seat. */
  registerPendingInteraction<T extends PendingInteraction>(
    precedence: (interaction: T) => number,
  ): PendingInteractionPublisher<T>
}
