import { type KeyboardEvent, type PointerEvent, useRef } from "react"
import { separatorKeyWidth, type WidthBounds } from "./panel-width"

/** The vertical separator on the panel's left edge: drag, or ←/→, Home and End with the keyboard. */
export function ResizeHandle(props: {
  /** The separator's accessible name. */
  label: string
  width: number
  /** Undefined until the shell is measured. */
  bounds: WidthBounds | undefined
  onResize(width: number): void
}) {
  const { width, bounds, onResize } = props
  const drag = useRef<{ x: number; width: number } | undefined>(undefined)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (start === undefined) return
    onResize(start.width + (start.x - event.clientX))
  }
  const end = () => {
    drag.current = undefined
  }
  const shown = bounds === undefined ? width : Math.min(Math.max(width, bounds.min), bounds.max)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (bounds === undefined) return
    const next = separatorKeyWidth(event.key, shown, bounds)
    if (next === undefined) return
    event.preventDefault()
    onResize(next)
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is a separator with a value (WAI-ARIA window splitter)
    <div
      className="dshb-files-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={shown}
      aria-valuemin={bounds?.min}
      aria-valuemax={bounds?.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  )
}
