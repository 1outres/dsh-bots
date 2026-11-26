import { createStore, type Observable } from "../observable"

export interface StackedScreen<Id extends string> {
  readonly id: Id
  readonly target: Observable<unknown>
}

export interface ScreenStack<Id extends string> extends Observable<readonly Id[]> {
  dispose(): void
}

export function createScreenStack<Id extends string>(
  screens: readonly StackedScreen<Id>[],
): ScreenStack<Id> {
  const isOpen = (screen: StackedScreen<Id>) => screen.target.getSnapshot() !== null
  const stack = createStore<readonly Id[]>(
    screens.filter(isOpen).map((screen) => screen.id),
    (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  )
  const sync = (screen: StackedScreen<Id>) => () =>
    stack.update((ids) => {
      const kept = ids.filter((id) => id !== screen.id)
      return isOpen(screen) ? (ids.includes(screen.id) ? ids : [...kept, screen.id]) : kept
    })
  const offs = screens.map((screen) => screen.target.subscribe(sync(screen)))
  return {
    getSnapshot: stack.getSnapshot,
    subscribe: stack.subscribe,
    dispose() {
      for (const off of offs) off()
    },
  }
}
