import { type KeyboardEvent, useCallback, useRef } from "react"
import { SidePanelFrame } from "../shell/SidePanelFrame"
import type { Translate } from "../types"
import type { MainViewFace } from "./face"

export interface SessionLogPanelProps {
  readonly t: Translate
  readonly sessionId: string
  readonly face: MainViewFace
  readonly containerRef: { readonly current: HTMLElement | null }
  close(): void
}

/** The Main session as DSH shows it (its tools, reasoning and notices), beside the timeline. */
export function SessionLogPanel(props: SessionLogPanelProps) {
  const { t, face, sessionId } = props
  const release = useRef<(() => void) | undefined>(undefined)
  const seat = useCallback(
    (element: HTMLDivElement | null) => {
      release.current?.()
      release.current = element === null ? undefined : face.seats.offer(sessionId, element)
    },
    [face, sessionId],
  )
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    props.close()
  }
  return (
    <SidePanelFrame
      label={t("sessionLog.panel")}
      title={t("sessionLog.title")}
      closeLabel={t("sessionLog.close")}
      resizeLabel={t("sessionLog.resize")}
      onClose={props.close}
      width={face.width}
      containerRef={props.containerRef}
      onKeyDown={onKeyDown}
      marks={{ "data-dshb-session-log": "" }}
    >
      <div className="dshb-session-log" ref={seat} />
    </SidePanelFrame>
  )
}
