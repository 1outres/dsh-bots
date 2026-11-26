import { createStore, type Observable } from "./observable"
import type { RegistrationStatus } from "./session-classification"
import { BOT_SESSION_PRIORITY } from "./slot-priority"

export const COMPOSER_SEATS = ["modelSeat", "permissionSeat"] as const

export type ComposerSeat = (typeof COMPOSER_SEATS)[number]

export const REGISTRATION_TARGETS = ["shell", "rightbar", ...COMPOSER_SEATS] as const

export type RegistrationTarget = (typeof REGISTRATION_TARGETS)[number]

export type Registrations = {
  readonly [Target in RegistrationTarget]: Observable<RegistrationStatus>
}

export interface SlotRegistrationOptions {
  readonly wanted: Observable<boolean>
  readonly register: (priority: number) => () => void
  readonly label: string
}

export interface SlotRegistration extends Observable<RegistrationStatus> {
  dispose(): void
}

const IDLE: RegistrationStatus = { state: "idle" }
const ACTIVE: RegistrationStatus = { state: "active" }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
