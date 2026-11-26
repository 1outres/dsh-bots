import { useEffect, useRef } from "react"
import { useCompactLayout } from "../ui"
import { type PanelFrameProps, PanelHeader } from "./PanelHeader"
import { popoverLayout } from "./panel-layout"

/** The most room a popover's body has, as CSS lengths (styles-shell.ts `.dshb-popover`). */
export const POPOVER_BODY_BOUNDS = {
  width: "var(--dshb-popover-body-width)",
  height: "var(--dshb-popover-body-height)",
} as const

/**
 * The frame of a panel floating over the chat by the menu bar: the side
 * panel's header over a body that sizes itself within
 * {@link POPOVER_BODY_BOUNDS}, a full-screen sheet on a compact window. It
 * takes focus as it opens; the chat beside it stays usable.
 */
export function PopoverPanelFrame(props: PanelFrameProps) {
  const surface = useRef<HTMLElement>(null)
  useEffect(() => {
    surface.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="dshb-popover-area" data-layout={popoverLayout(useCompactLayout())}>
      <section
        ref={surface}
        className="dshb-popover"
        role="dialog"
        aria-label={props.label}
        tabIndex={-1}
        onKeyDown={props.onKeyDown}
        {...props.marks}
      >
        <PanelHeader {...props} />
        <div className="dshb-panel-body">{props.children}</div>
      </section>
    </div>
  )
}
