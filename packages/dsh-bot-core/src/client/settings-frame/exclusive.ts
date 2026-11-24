import type { Observable } from "../observable"

/** A settings screen as far as another screen opening needs it. */
export interface ClosableScreen {
  readonly target: Observable<unknown>
  close(): void
}

/**
 * Open a screen only once every other one is closed. An open one is asked to
 * close; one that keeps unsaved changes asks the user first, and the new screen
 * then stays closed.
 */
export function openAlone(others: readonly ClosableScreen[], open: () => void): void {
  for (const other of others) {
    if (other.target.getSnapshot() !== null) other.close()
  }
  if (others.every((other) => other.target.getSnapshot() === null)) open()
}
