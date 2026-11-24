import { SLOT, type SlotName } from "../dsh/slots"
import { createStore, type Observable } from "../observable"
import type { RegistrationStatus } from "../session-classification"
import { type ComposerSeat, createSlotRegistration } from "../slot-registration"
import type { ClientContext } from "../types"

export type ComposerSeatRegistrations = {
  readonly [Seat in ComposerSeat]: Observable<RegistrationStatus>
}

const SEAT_SLOTS: { readonly [Seat in ComposerSeat]: SlotName } = {
  modelSeat: SLOT.inputModel,
  permissionSeat: SLOT.inputPermission,
}

/** What a bot session's composer shows in a seat bot-core empties: nothing. */
function EmptySeat() {
  return null
}

/**
 * Empties the composer seats whose controls are a bot's own settings (its
 * models, its permission) while the main view shows a bot session: single
 * Slots, each held at the bot session priority (`slot-priority.ts`) only
 * then, below DSH's control and any plugin's replacement of it, which every
 * other session keeps.
 */
export function wireComposerSeats(
  ctx: ClientContext,
  occupies: Observable<boolean>,
): ComposerSeatRegistrations {
  const wire = (seat: ComposerSeat) => wireSeat(ctx, occupies, SEAT_SLOTS[seat])
  return { modelSeat: wire("modelSeat"), permissionSeat: wire("permissionSeat") }
}

function wireSeat(
  ctx: ClientContext,
  occupies: Observable<boolean>,
  slot: SlotName,
): Observable<RegistrationStatus> {
  const status = createStore<RegistrationStatus>({ state: "idle" })
  ctx.effect(
    () =>
      ctx.slots.inject(slot, () => {
        const registration = createSlotRegistration({
          wanted: occupies,
          label: `bot session ${slot}`,
          register: (priority) => ctx.slots.register({ name: slot, priority }, EmptySeat),
        })
        const report = () => status.set(registration.getSnapshot())
        report()
        const off = registration.subscribe(report)
        return () => {
          registration.dispose()
          report()
          off()
        }
      }),
    `bot-core: bot session ${slot}`,
  )
  return status
}
