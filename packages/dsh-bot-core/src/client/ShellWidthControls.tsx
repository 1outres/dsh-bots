import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react"
import type { ShellPhase } from "./shell-phase"

/**
 * The main Conversation's transcript width axis and drag handles, copied from
 * DSH's ConversationWidthControls (skeleton/ConversationWidthControls.tsx,
 * see upstream.ts). Classes renamed (`dshb-width-handle`, styles-shell.ts);
 * the persisted preference key is DSH's own, so the bot shell and the stock
 * shell share one width.
 */

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = "dsh.conversation.contentWidth"
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640
/** Horizontal room reserved for both handles and their safe edge zones. */
const CONTENT_EDGE_BUDGET = 176
const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const FALLBACK_WHEEL_LINE_PX = 16

export interface ShellWidthControlsProps {
  readonly container: HTMLDivElement | null
  readonly phase: ShellPhase
}

/** Read a valid persisted width preference, or null when absent or corrupt. */
function readWidthPreference(): number | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(WIDTH_PREF_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Resolve the width displayed for one measured Conversation column. */
export function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET)
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max)
  return Math.max(680, Math.min(columnWidth * 0.64, 920))
}

/** Convert a wheel event's vertical delta to scrollport pixels. */
function wheelDeltaY(event: ReactWheelEvent, scrollport: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(scrollport).lineHeight)
    return event.deltaY * (Number.isFinite(lineHeight) ? lineHeight : FALLBACK_WHEEL_LINE_PX)
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * scrollport.clientHeight
  return event.deltaY
}

interface HandleProps {
  side: "left" | "right"
  onStart: () => number
  onDrag: (width: number) => void
  onCommit: (width: number) => void
  onEnd: () => void
}

/** One pointer-captured transcript width handle. */
function WidthHandle(props: HandleProps) {
  const dragging = useRef(false)
  const base = useRef(0)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const outwardWidth = () => {
    const dx = latest.current - origin.current
    const outward = callbacks.current.side === "right" ? dx : -dx
    return base.current + outward * 2
  }
  const cancelFrame = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    base.current = callbacks.current.onStart()
    dragging.current = true
    event.currentTarget.toggleAttribute("data-dragging", true)
  }, [])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty(
      "--dsh-width-handle-pointer-y",
      `${event.clientY - box.top}px`,
    )
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(outwardWidth())
    })
  }, [])
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    dragging.current = false
    event.currentTarget.toggleAttribute("data-dragging", false)
    event.currentTarget.releasePointerCapture(event.pointerId)
    cancelFrame()
    latest.current = event.clientX
    // A press-only gesture must not overwrite a wider preference with its window-clamped display value.
    if (latest.current !== origin.current) callbacks.current.onCommit(outwardWidth())
    callbacks.current.onEnd()
  }, [])
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.toggleAttribute("data-dragging", false)
    // Cancellation abandons persistence and restores the saved width through onEnd.
    cancelFrame()
    callbacks.current.onEnd()
  }, [])
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const body = event.currentTarget.parentElement
    if (body === null) return
    const scrollport = body.querySelector<HTMLElement>("[data-conversation-scroll]")
    if (scrollport === null) return
    if (event.ctrlKey || event.deltaY === 0) return
    scrollport.scrollBy({ top: wheelDeltaY(event, scrollport) })
  }, [])

  return (
    <div
      className="dshb-width-handle"
      data-side={props.side}
      data-width-handle={props.side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onWheel={onWheel}
    />
  )
}

/** Install the main Conversation width axis and render its drag handles (active phase only). */
export function ShellWidthControls({ container, phase }: ShellWidthControlsProps) {
  const publishWidths = useCallback((element: HTMLDivElement): void => {
    const target = element.parentElement ?? element
    const column = element.offsetWidth
    target.style.setProperty("--dsh-conversation-column-width", `${column}px`)
    const preference = readWidthPreference()
    if (preference === null) target.style.removeProperty("--dsh-chat-user-width")
    else
      target.style.setProperty(
        "--dsh-chat-user-width",
        `${resolveContentWidth(column, preference)}px`,
      )
  }, [])

  useLayoutEffect(() => {
    if (container === null) return
    const observer = new ResizeObserver(() => {
      publishWidths(container)
    })
    observer.observe(container)
    publishWidths(container)
    return () => {
      observer.disconnect()
    }
  }, [container, publishWidths])

  const onStart = useCallback((): number => {
    if (container === null) return 680
    return resolveContentWidth(container.offsetWidth, readWidthPreference())
  }, [container])
  const onDrag = useCallback(
    (width: number): void => {
      if (container === null) return
      const target = container.parentElement ?? container
      target.style.setProperty(
        "--dsh-chat-user-width",
        `${resolveContentWidth(container.offsetWidth, width)}px`,
      )
    },
    [container],
  )
  const onCommit = useCallback(
    (width: number): void => {
      if (container === null) return
      try {
        localStorage.setItem(WIDTH_PREF_KEY, `${resolveContentWidth(container.offsetWidth, width)}`)
      } catch {
        // Storage unavailable: the width lasts until the next resize.
      }
    },
    [container],
  )
  const onEnd = useCallback((): void => {
    if (container !== null) publishWidths(container)
  }, [container, publishWidths])

  if (container === null || phase !== "active") return null
  return (["left", "right"] as const).map((side) => (
    <WidthHandle
      key={side}
      side={side}
      onStart={onStart}
      onDrag={onDrag}
      onCommit={onCommit}
      onEnd={onEnd}
    />
  ))
}
