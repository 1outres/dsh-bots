import { createStore, type Observable } from "./observable"
import type { RegistrationStatus } from "./session-classification"
import { BOT_SESSION_PRIORITY } from "./slot-priority"

/** The composer seats bot-core empties for bot sessions. */
export const COMPOSER_SEATS = ["modelSeat", "permissionSeat"] as const

export type ComposerSeat = (typeof COMPOSER_SEATS)[number]

/** The single Slots bot-core takes over for bot sessions. */
export const REGISTRATION_TARGETS = ["shell", "rightbar", ...COMPOSER_SEATS] as const

export type RegistrationTarget = (typeof REGISTRATION_TARGETS)[number]

export type Registrations = {
  readonly [Target in RegistrationTarget]: Observable<RegistrationStatus>
}

export interface SlotRegistrationOptions {
  /** Whether the registration should be in place right now. */
  readonly wanted: Observable<boolean>
  /** Register at `priority` and return the disposer; throws when the Slot refuses. */
  readonly register: (priority: number) => () => void
  /** Names the registration in the console. */
  readonly label: string
}

export interface SlotRegistration extends Observable<RegistrationStatus> {
  dispose(): void
}

const IDLE: RegistrationStatus = { state: "idle" }
const ACTIVE: RegistrationStatus = { state: "active" }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Keep a registration in place while it is wanted, at {@link BOT_SESSION_PRIORITY}
 * only. A refusal is final: it is logged, reported as `refused`, and never
 * retried, so the page shows the error rather than another priority's outcome.
 */
export function createSlotRegistration(options: SlotRegistrationOptions): SlotRegistration {
  const { wanted, register, label } = options
  const status = createStore<RegistrationStatus>(IDLE)
  let release: (() => void) | undefined

  const unregister = () => {
    const dispose = release
    release = undefined
    status.set(IDLE)
    dispose?.()
  }

  const sync = () => {
    if (status.getSnapshot().state === "refused") return
    if (!wanted.getSnapshot()) {
      unregister()
      return
    }
    if (release !== undefined) return
    try {
      release = register(BOT_SESSION_PRIORITY)
    } catch (error) {
      console.error(
        `bot-core: the ${label} registration was refused at priority ${BOT_SESSION_PRIORITY}`,
        error,
      )
      status.set({ state: "refused", error: messageOf(error) })
      return
    }
    status.set(ACTIVE)
  }

  const off = wanted.subscribe(sync)
  sync()

  return {
    getSnapshot: status.getSnapshot,
    subscribe: status.subscribe,
    dispose() {
      off()
      if (status.getSnapshot().state !== "refused") unregister()
    },
  }
}
