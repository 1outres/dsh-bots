// Source: dsh-client-connection/src/client/index.ts (`ConnectionHandle`).
import type { Observable } from "../observable"

/** `ctx.connection`, as far as bot-core uses it. */
export interface ConnectionFace {
  /** The active Remote event generation: undefined before readiness and while reconnecting, a new value on every re-establishment. */
  readonly generation: Observable<object | undefined>
}
