import type { Observable } from "../observable"

export interface ConnectionFace {
  readonly generation: Observable<object | undefined>
}
