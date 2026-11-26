import type { Observable } from "../observable"

export interface ClosableScreen {
  readonly target: Observable<unknown>
  close(): void
}

export function openAlone(others: readonly ClosableScreen[], open: () => void): void {
  for (const other of others) {
    if (other.target.getSnapshot() !== null) other.close()
  }
  if (others.every((other) => other.target.getSnapshot() === null)) open()
}
