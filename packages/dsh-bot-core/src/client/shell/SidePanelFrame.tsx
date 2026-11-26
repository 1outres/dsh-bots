import { useElementWidth } from "../files/element-width"
import { type PanelWidth, widthBounds } from "../files/panel-width"
import { ResizeHandle } from "../files/ResizeHandle"
import { useObservable } from "../hooks"
import { useCompactLayout } from "../ui"
import { type PanelFrameProps, PanelHeader } from "./PanelHeader"
import { panelLayout } from "./panel-layout"

export interface SidePanelFrameProps extends PanelFrameProps {
  readonly resizeLabel: string
  readonly width: PanelWidth
  /** The shell, whose width the panel shares. */
  readonly containerRef: { readonly current: HTMLElement | null }
}

/**
 * The frame every side panel of the bot session shell shares (Files, Actions,
 * connectors' panels): a header on the shell header's line, a resizable left
 * edge, beside the chat while the chat keeps 640px, over it otherwise, and a
 * full-screen sheet on a compact window.
 */
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
      <PanelHeader {...props} />
      <div className="dshb-panel-body">{props.children}</div>
    </section>
  )
}
