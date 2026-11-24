/**
 * Where focus goes once the panel's own navigation has replaced the element
 * that had it: the preview's heading after a file opens from the browser, the
 * file's row (or, without one, the search field) after going back.
 */
export type FocusTarget = "preview" | "browser"

/** One pending focus move, requested by the action and taken by the view that draws its target. */
export interface PanelFocus {
  request(target: FocusTarget): void
  /** Whether `target` is the pending move; taking it clears it. */
  take(target: FocusTarget): boolean
}

export function createPanelFocus(): PanelFocus {
  let pending: FocusTarget | undefined
  return {
    request(target) {
      pending = target
    },
    take(target) {
      if (pending !== target) return false
      pending = undefined
      return true
    },
  }
}
