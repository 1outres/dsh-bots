import { SLOT, type SlotEntry, type SlotsService } from "../dsh/slots"
import type { Observable } from "../observable"

export type StoreHandle =
  | { readonly state: "present"; readonly store: object }
  | { readonly state: "missing" }

const MISSING: StoreHandle = { state: "missing" }

const sameHandle = (a: StoreHandle, b: StoreHandle) =>
  a.state === "present" ? b.state === "present" && a.store === b.store : b.state === "missing"

export function storeHandleOf(corner: readonly SlotEntry[]): StoreHandle {
  const store = corner[0]?.store
  return typeof store === "object" && store !== null ? { state: "present", store } : MISSING
}

export function cornerStoreHandle(
  slots: Pick<SlotsService, "entriesOfSlot" | "subscribe">,
): Observable<StoreHandle> {
  let current: StoreHandle = MISSING
  const read = () => {
    const next = storeHandleOf(slots.entriesOfSlot(SLOT.sessionHeaderCorner))
    if (!sameHandle(current, next)) current = next
    return current
  }
  return {
    getSnapshot: read,
    subscribe(listener) {
      let last = read()
      return slots.subscribe(SLOT.sessionHeaderCorner, () => {
        const next = read()
        if (next === last) return
        last = next
        listener()
      })
    },
  }
}
