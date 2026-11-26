import { createStore, derive, type Observable } from "../observable"
import type { RegistrationStatus } from "../session-classification"

export interface LockdownStatus {
  readonly handle: "present" | "missing"
  readonly registration: RegistrationStatus
  readonly broken: boolean
}

export const INITIAL_LOCKDOWN_STATUS: LockdownStatus = {
  handle: "missing",
  registration: { state: "idle" },
  broken: false,
}

export function linksAvailable(status: LockdownStatus): boolean {
  return status.handle === "present" && status.registration.state !== "refused" && !status.broken
}

const sameRegistration = (a: RegistrationStatus, b: RegistrationStatus) =>
  a.state === b.state && (a.state !== "refused" || (b.state === "refused" && a.error === b.error))

const sameStatus = (a: LockdownStatus, b: LockdownStatus) =>
  a.handle === b.handle && a.broken === b.broken && sameRegistration(a.registration, b.registration)

export interface LockdownReporter {
  markBroken(): void
}

export interface LockdownStatusStore extends Observable<LockdownStatus>, LockdownReporter {
  readonly linksAvailable: Observable<boolean>
  setHandle(handle: LockdownStatus["handle"]): void
  setRegistration(registration: RegistrationStatus): void
}

export function createLockdownStatus(): LockdownStatusStore {
  const store = createStore(INITIAL_LOCKDOWN_STATUS, sameStatus)
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    linksAvailable: derive([store], linksAvailable),
    setHandle: (handle) => store.update((status) => ({ ...status, handle })),
    setRegistration: (registration) => store.update((status) => ({ ...status, registration })),
    markBroken: () => store.update((status) => ({ ...status, broken: true })),
  }
}
