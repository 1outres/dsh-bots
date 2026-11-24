/** Where a popover is drawn, in viewport pixels (`position: fixed`). */
export interface Placement {
  readonly left: number
  readonly width: number
  readonly top?: number
  readonly bottom?: number
  readonly maxHeight: number
}

const GAP = 4
const MARGIN = 16
const MAX_HEIGHT = 320

/** Under the anchor, right-aligned to it, or above it when there is more room there. */
export function placeUnder(anchor: HTMLElement, minWidth = 280): Placement {
  const rect = anchor.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - GAP - MARGIN
  const above = rect.top - GAP - MARGIN
  const width = Math.max(rect.width, minWidth)
  const left = Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN))
  return below >= Math.min(MAX_HEIGHT, above)
    ? { left, width, top: rect.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) }
    : {
        left,
        width,
        bottom: window.innerHeight - rect.top + GAP,
        maxHeight: Math.min(MAX_HEIGHT, above),
      }
}
