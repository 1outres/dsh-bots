import type { KeyboardEvent, ReactNode, Ref } from "react"
import { useElementWidth } from "../files/element-width"
import { type PanelWidth, widthBounds } from "../files/panel-width"
import { ResizeHandle } from "../files/ResizeHandle"
import { useObservable } from "../hooks"
import { IconClose } from "../icons"
import { type DataMarks, useCompactLayout } from "../ui"
import { panelLayout } from "./panel-layout"

export interface SidePanelFrameProps {
  readonly label: string
  readonly title: string
  readonly titleHint?: string
  readonly titleRef?: Ref<HTMLHeadingElement>
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly closeLabel: string
  readonly resizeLabel: string
  onClose(): void
  readonly width: PanelWidth
  readonly containerRef: { readonly current: HTMLElement | null }
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  readonly marks: DataMarks
  readonly children: ReactNode
}

export function SidePanelFrame(props: SidePanelFrameProps) {
  const width = useObservable(props.width)
  const shellWidth = useElementWidth(props.containerRef)
  const layout = panelLayout({ shellWidth, panelWidth: width, compact: useCompactLayout() })
  const resize = (next: number) => {
    const container = props.containerRef.current
    if (container !== null) props.width.resize(next, container.clientWidth)
  }
  return (
    <section
      className="dshb-panel"
      data-layout={layout}
      style={layout === "sheet" ? undefined : { width }}
      aria-label={props.label}
      onKeyDown={props.onKeyDown}
      {...props.marks}
    >
      {layout !== "sheet" && (
        <ResizeHandle
          label={props.resizeLabel}
          width={width}
          bounds={shellWidth === undefined ? undefined : widthBounds(shellWidth)}
          onResize={resize}
        />
      )}
      <header className="dshb-panel-header">
        {props.leading}
        <h2
          ref={props.titleRef}
          className="dshb-panel-title"
          tabIndex={-1}
          title={props.titleHint ?? props.title}
        >
          {props.title}
        </h2>
        {props.trailing}
        <button
          type="button"
          className="dshb-shell-button"
          aria-label={props.closeLabel}
          title={props.closeLabel}
          onClick={props.onClose}
        >
          <IconClose size={16} />
        </button>
      </header>
      <div className="dshb-panel-body">{props.children}</div>
    </section>
  )
}
