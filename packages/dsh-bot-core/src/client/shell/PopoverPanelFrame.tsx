import { type ReactNode, useId, useRef } from "react"
import type { DataMarks } from "../ui"
import { OverlayFrame, OverlayTitle } from "../ui/OverlayFrame"

/** The most room a popover's body has, as CSS lengths (styles-shell.ts `.dshb-popover`). */
export const POPOVER_BODY_BOUNDS = {
  width: "var(--dshb-overlay-body-width)",
  height: "var(--dshb-overlay-body-height)",
} as const

export interface PopoverPanelFrameProps {
  readonly title: string
  /** Between the title and × (the connector's note). */
  readonly trailing?: ReactNode
  readonly closeLabel: string
  onClose(): void
  /** A person operates what the body shows: their keys go to it, and the mask does not close it. */
  readonly held: boolean
  /** A settings screen is open over it. */
  readonly covered: boolean
  returnFocusTo(): readonly string[]
  readonly marks: DataMarks
  readonly children: ReactNode
}

/**
 * A shell panel as a large popover over the app, in the settings screens'
 * frame ({@link OverlayFrame}): as large as its body, which sizes itself
 * within {@link POPOVER_BODY_BOUNDS}. ×, Escape and the mask close it, except
 * that while it is held only × does.
 */
export function PopoverPanelFrame(props: PopoverPanelFrameProps) {
  const surface = useRef<HTMLDivElement>(null)
  const titleId = useId()
  return (
    <OverlayFrame
      surfaceRef={surface}
      titleId={titleId}
      heading={
        <>
          <OverlayTitle id={titleId} title={props.title} hint={props.title} />
          {props.trailing}
        </>
      }
      closeLabel={props.closeLabel}
      closeMarks={{ "data-dshb-popover-close": "" }}
      onClose={props.onClose}
      dismissible={!props.held}
      onEscape={props.onClose}
      yieldKeys={props.held}
      covered={props.covered}
      returnFocusTo={props.returnFocusTo}
      surfaceClass="dshb-popover"
      marks={props.marks}
    >
      <div className="dshb-popover-body">{props.children}</div>
    </OverlayFrame>
  )
}
