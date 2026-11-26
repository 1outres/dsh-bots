import { type ReactNode, useId, useRef } from "react"
import type { DataMarks } from "../ui"
import { OverlayFrame, OverlayTitle } from "../ui/OverlayFrame"

export const POPOVER_BODY_BOUNDS = {
  width: "var(--dshb-overlay-body-width)",
  height: "var(--dshb-overlay-body-height)",
} as const

export interface PopoverPanelFrameProps {
  readonly title: string
  readonly trailing?: ReactNode
  readonly closeLabel: string
  onClose(): void
  readonly held: boolean
  readonly covered: boolean
  returnFocusTo(): readonly string[]
  readonly marks: DataMarks
  readonly children: ReactNode
}

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
