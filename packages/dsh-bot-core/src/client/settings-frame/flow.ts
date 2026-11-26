import { createStore, type Observable, type Store } from "../observable"
import type { PendingEdits } from "../ui/pending-edits"

export interface FrameTarget {
  readonly section: string | null
  readonly detail: string | null
  readonly nav: boolean
}

export type FrameLeave = "move" | "close"

export interface FrameGuard {
  readonly pending: boolean
  readonly leaving: FrameLeave | null
}

export interface FrameConfirmation {
  readonly title: string
  readonly description: string
  readonly confirm: string
  readonly tone: "primary" | "danger"
}

export interface FrameControls {
  readonly guard: Observable<FrameGuard>
  readonly edits: PendingEdits
  readonly asking: Observable<FrameConfirmation | null>
  select(section: string): void
  openDetail(detail: string): void
  back(): void
  showNav(): void
  close(): void
  dismiss(): void
  discard(): void
  keepEditing(): void
  confirm(request: FrameConfirmation): Promise<boolean>
  answer(confirmed: boolean): void
}

export interface FrameFlow<Target extends FrameTarget> extends FrameControls {
  readonly target: Observable<Target | null>
  sectionOf(section?: string): string | null
  open(target: Target): void
  replace(target: Target): void
  dispose(): void
}

export interface FrameFlowOptions<Target extends FrameTarget> {
  readonly store: Store<Target | null>
  readonly sections: Observable<readonly { readonly id: string }[]>
  readonly noun: string
  sameScreen(a: Target, b: Target): boolean
}

const sameGuard = (a: FrameGuard, b: FrameGuard) =>
  a.pending === b.pending && a.leaving === b.leaving

const samePlace = (a: FrameTarget, b: FrameTarget) =>
  a.section === b.section && a.detail === b.detail && a.nav === b.nav

type Way<Target> = { readonly to: Target | null } | null

export function createFrameFlow<Target extends FrameTarget>(
  options: FrameFlowOptions<Target>,
): FrameFlow<Target> {
  const { store, sections, noun, sameScreen } = options
  const guard = createStore<FrameGuard>({ pending: false, leaving: null }, sameGuard)
  const asking = createStore<FrameConfirmation | null>(null)
  const holds = new Set<symbol>()
  let way: Way<Target> = null

  const refresh = () =>
    guard.set({
      pending: holds.size > 0,
      leaving: way === null ? null : way.to === null ? "close" : "move",
    })
  const forget = () => {
    holds.clear()
    way = null
    refresh()
  }

  let settle: ((confirmed: boolean) => void) | undefined
  const answer = (confirmed: boolean) => {
    const pending = settle
    settle = undefined
    asking.set(null)
    pending?.(confirmed)
  }

  let shown = store.getSnapshot()
  const off = store.subscribe(() => {
    const next = store.getSnapshot()
    const screenChanged =
      shown === null || next === null ? shown !== next : !sameScreen(shown, next)
    if (screenChanged) forget()
    if (screenChanged || (shown !== null && next !== null && !samePlace(shown, next))) {
      answer(false)
    }
    shown = next
  })

  const registered = (section: string): string => {
    if (!sections.getSnapshot().some((item) => item.id === section)) {
      throw new Error(`bot-core: ${noun} "${section}" is not registered`)
    }
    return section
  }

  const go = (to: Target | null) => {
    if (store.getSnapshot() === null) return
    if (holds.size > 0) {
      way = { to }
      refresh()
      return
    }
    store.set(to)
  }
  const move = (place: Partial<FrameTarget>) => {
    const target = store.getSnapshot()
    if (target === null) return
    const next: Target = { ...target, ...place }
    if (samePlace(target, next)) {
      keepEditing()
      return
    }
    go(next)
  }
  const keepEditing = () => {
    if (way === null) return
    way = null
    refresh()
  }

  return {
    target: store,
    guard,
    asking,
    edits: {
      hold() {
        const token = Symbol("edit")
        holds.add(token)
        refresh()
        return () => {
          if (holds.delete(token)) refresh()
        }
      },
    },
    sectionOf: (section) =>
      section === undefined ? (sections.getSnapshot()[0]?.id ?? null) : registered(section),
    open(target) {
      const current = store.getSnapshot()
      if (current !== null && sameScreen(current, target)) {
        move({ section: target.section, detail: target.detail, nav: target.nav })
        return
      }
      store.set(target)
    },
    replace(target) {
      forget()
      store.set(target)
    },
    select: (section) => move({ section: registered(section), detail: null, nav: false }),
    openDetail: (detail) => move({ detail, nav: false }),
    back: () => move({ detail: null }),
    showNav: () => move({ detail: null, nav: true }),
    close: () => go(null),
    dismiss() {
      forget()
      store.set(null)
    },
    discard() {
      const waiting = way
      if (waiting === null) return
      forget()
      store.set(waiting.to)
    },
    keepEditing,
    confirm(request) {
      if (store.getSnapshot() === null) return Promise.resolve(false)
      answer(false)
      return new Promise<boolean>((resolve) => {
        settle = resolve
        asking.set(request)
      })
    },
    answer,
    dispose() {
      answer(false)
      off()
    },
  }
}
