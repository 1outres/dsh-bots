import { type CSSProperties, type ReactNode, type RefObject, useState } from "react"
import { IconClose } from "../icons"
import { Button } from "./Button"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { useCompactLayout } from "./viewport"

export interface OverlayFrameProps {
  readonly surfaceRef: RefObject<HTMLDivElement>
  /** The id of the title in `heading`, which names the dialog. */
  readonly titleId: string
  /** The header line before ×: a back button or an avatar, and the title ({@link OverlayTitle}). */
  readonly heading: ReactNode
  readonly closeLabel: string
  readonly closeMarks: DataMarks
  /** × closes, and so does the mask while the frame is dismissible. */
  onClose(): void
  readonly dismissible: boolean
  onEscape(): void
  /** Escape and Tab go to what has focus in the frame (a person typing into a remote screen). */
  readonly yieldKeys: boolean
  /** Another screen is open over this one: it stays as it is, hidden and out of reach. */
  readonly covered: boolean
  /** Selectors of the elements focus returns to on closing when the opener is gone, in order of preference. */
  returnFocusTo(): readonly string[]
  /** The class of the surface, which lays out what is under the header. */
  readonly surfaceClass: string
  readonly surfaceStyle?: CSSProperties
  readonly marks: DataMarks
  readonly children: ReactNode
  /** Drawn over the surface (a confirmation). */
  readonly over?: ReactNode
}

/**
 * A large popover over the app, the frame of bot-core's screens (the
 * settings, a connector's screen): a mask, a one-line header with ×, a
 * full-screen sheet on a compact window. It is a trapping layer of
 * `layers.ts`: Escape, Tab and focus stay in it, and focus returns to its
 * opener once it closes.
 */
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

/** The title on an overlay frame's header line. */
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
