import { type CSSProperties, type ReactNode, type RefObject, useState } from "react"
import { IconClose } from "../icons"
import { Button } from "./Button"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { useCompactLayout } from "./viewport"

export interface OverlayFrameProps {
  readonly surfaceRef: RefObject<HTMLDivElement>
  readonly titleId: string
  readonly heading: ReactNode
  readonly closeLabel: string
  readonly closeMarks: DataMarks
  onClose(): void
  readonly dismissible: boolean
  onEscape(): void
  readonly yieldKeys: boolean
  readonly covered: boolean
  returnFocusTo(): readonly string[]
  readonly surfaceClass: string
  readonly surfaceStyle?: CSSProperties
  readonly marks: DataMarks
  readonly children: ReactNode
  readonly over?: ReactNode
}

export function OverlayFrame(props: OverlayFrameProps) {
  const compact = useCompactLayout()
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  )
  const [returnTo] = useState(() => props.returnFocusTo)
  useLayer(props.surfaceRef, {
    active: true,
    trap: true,
    yieldKeys: props.yieldKeys,
    onEscape: props.onEscape,
    restore: () =>
      [opener, ...returnTo().map((selector) => document.querySelector<HTMLElement>(selector))].find(
        (element) => element?.isConnected === true,
      ) ?? null,
  })
  const inert = props.covered ? { inert: "" } : {}
  return (
    <div
      className="dshb-overlay-root"
      data-layout={compact ? "compact" : "wide"}
      data-covered={props.covered ? "" : undefined}
      {...inert}
    >
      <div
        className="dshb-overlay-mask"
        aria-hidden="true"
        onClick={() => {
          if (props.dismissible) props.onClose()
        }}
      />
      <div
        ref={props.surfaceRef}
        className={`dshb-overlay ${props.surfaceClass}`}
        style={props.surfaceStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.titleId}
        tabIndex={-1}
        {...props.marks}
      >
        <header className="dshb-overlay-header">
          {props.heading}
          <Button
            variant="icon"
            label={props.closeLabel}
            onClick={props.onClose}
            marks={props.closeMarks}
          >
            <IconClose size={14} />
          </Button>
        </header>
        {props.children}
      </div>
      {props.over}
    </div>
  )
}

export function OverlayTitle(props: {
  readonly id: string
  readonly title: string
  readonly hint?: string
}) {
  return (
    <h2 id={props.id} className="dshb-overlay-title" title={props.hint}>
      {props.title}
    </h2>
  )
}
