import { createStore, type Observable, type Store } from "../observable"
import type { PendingEdits } from "../ui/pending-edits"

/** Where an open settings screen is. */
export interface FrameTarget {
  /** The section shown, `null` while no section is registered. */
  readonly section: string | null
  /** The detail page the section pushed over its first page, `null` on the first page. */
  readonly detail: string | null
  /** Whether a compact (sheet) screen shows its list of sections instead of the section; a wide screen shows both. */
  readonly nav: boolean
}

/** Where the user asked to go while typed text waits: elsewhere on the screen, or out of it. */
export type FrameLeave = "move" | "close"

export interface FrameGuard {
  /** Whether an inline editor holds typed, unsaved text. */
  readonly pending: boolean
  /** The way out waiting for the user to discard the typed text, while the confirmation is shown. */
  readonly leaving: FrameLeave | null
}

/** What a section asks the user to confirm before it goes on, in the user's language. */
export interface FrameConfirmation {
  readonly title: string
  /** One line. */
  readonly description: string
  /** The label of the button that goes on. */
  readonly confirm: string
  /** `danger` for a step that weakens a safeguard, interrupts work or deletes. */
  readonly tone: "primary" | "danger"
}

/** What a settings screen's frame drives. */
export interface FrameControls {
  readonly guard: Observable<FrameGuard>
  /** Inline editors hold this while they have typed, unsaved text. */
  readonly edits: PendingEdits
  /** The confirmation shown, until the user answers it. */
  readonly asking: Observable<FrameConfirmation | null>
  /** Show `section`'s first page. */
  select(section: string): void
  /** Push a detail page of the open section; another detail replaces it. */
  openDetail(detail: string): void
  /** From a detail page back to the section's first page. */
  back(): void
  /** On a compact screen, back from the section to the list of sections. */
  showNav(): void
  /** Close the screen. */
  close(): void
  /** Close at once, typed text dropped. */
  dismiss(): void
  /** Drop the typed text and take the way out that waits. */
  discard(): void
  /** Stay where the user was, typed text kept. */
  keepEditing(): void
  /**
   * Ask the user to confirm a step of the open section. Resolves with the
   * answer; false when the screen closes, moves elsewhere or another
   * confirmation replaces this one.
   */
  confirm(request: FrameConfirmation): Promise<boolean>
  answer(confirmed: boolean): void
}

/**
 * Opening, moving through and closing one settings screen. Every move (another
 * section, a detail page, back, closing) waits for the user to discard typed
 * text an inline editor holds.
 */
export interface FrameFlow<Target extends FrameTarget> extends FrameControls {
  readonly target: Observable<Target | null>
  /**
   * The registered id of `section`, or the first registered section when
   * omitted (`null` when none is).
   * @throws when `section` is not registered.
   */
  sectionOf(section?: string): string | null
  /** Show `target`; on the same screen already open, this moves there. */
  open(target: Target): void
  /** Show `target` at once, typed text dropped (the section shown went away). */
  replace(target: Target): void
  dispose(): void
}

export interface FrameFlowOptions<Target extends FrameTarget> {
  readonly store: Store<Target | null>
  readonly sections: Observable<readonly { readonly id: string }[]>
  /** Names the sections in errors. */
  readonly noun: string
  /** Whether two targets are the same screen; typed text is forgotten across screens. */
  sameScreen(a: Target, b: Target): boolean
}

const sameGuard = (a: FrameGuard, b: FrameGuard) =>
  a.pending === b.pending && a.leaving === b.leaving

const samePlace = (a: FrameTarget, b: FrameTarget) =>
  a.section === b.section && a.detail === b.detail && a.nav === b.nav

/** A waiting way out: where to (`null` closes), or nothing. */
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
