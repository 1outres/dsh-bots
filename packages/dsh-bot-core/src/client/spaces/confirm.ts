import { createStore, type Observable } from "../observable"
import type { FrameConfirmation } from "../settings-frame/flow"
import type { SpaceConfirm } from "./flows"

export interface SpaceConfirmations {
  readonly asking: Observable<FrameConfirmation | null>
  readonly confirm: SpaceConfirm
  answer(confirmed: boolean): void
}

export function createSpaceConfirmations(): SpaceConfirmations {
  const asking = createStore<FrameConfirmation | null>(null)
  let settle: ((confirmed: boolean) => void) | undefined
  const answer = (confirmed: boolean) => {
    const pending = settle
    settle = undefined
    asking.set(null)
    pending?.(confirmed)
  }
  return {
    asking,
    confirm(request) {
      answer(false)
      return new Promise<boolean>((resolve) => {
        settle = resolve
        asking.set(request)
      })
    },
    answer,
  }
}
