import type { ConnectorPanelFrame, ConnectorPanelProps } from "@1outres/dsh-bot-core"
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { type Resolution, resolutionOf } from "../shared/resolution"
import { SCREEN_STREAM } from "../shared/screen"
import type { Translate } from "./dsh"
import { ScreenSession, type ScreenState } from "./screen-session"
import { PANEL_CSS } from "./styles"

export interface DesktopPanelProps extends ConnectorPanelProps {
  readonly t: Translate
}

const NO_SUBSCRIPTION = () => () => {}
const NOT_YET = () => undefined

const timers = {
  now: () => Date.now(),
  later(ms: number, work: () => void) {
    const timer = setTimeout(work, ms)
    return () => clearTimeout(timer)
  },
}

const page = {
  hidden: () => document.visibilityState === "hidden",
  onChange(listener: () => void) {
    document.addEventListener("visibilitychange", listener)
    return () => document.removeEventListener("visibilitychange", listener)
  },
}

function useScreen(session: ScreenSession | undefined): ScreenState | undefined {
  return useSyncExternalStore(
    session?.subscribe ?? NO_SUBSCRIPTION,
    session?.getSnapshot ?? NOT_YET,
  )
}

function useSeconds(until: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])
  return until === undefined ? undefined : Math.max(0, Math.ceil((until - now) / 1000))
}

function statusText(t: Translate, state: ScreenState, seconds: number | undefined): string {
  switch (state.status) {
    case "connecting":
      return t("status.connecting")
    case "paused":
      return t("status.paused")
    case "disconnected":
      return seconds === undefined
        ? t("status.disconnected")
        : t("status.reconnecting", { seconds })
    case "connected":
      return t(`holder.${state.holder}`)
  }
}

/** In a popover, the panel sizes the screen to the desktop's aspect within the frame's bounds (styles.ts). */
function frameStyle(frame: ConnectorPanelFrame, screen: Resolution): CSSProperties | undefined {
  switch (frame.presentation) {
    case "side":
      return undefined
    case "popover":
      return {
        "--dsdk-max-width": frame.bounds.width,
        "--dsdk-max-height": frame.bounds.height,
        "--dsdk-ratio": screen.width / screen.height,
      } as CSSProperties
  }
}

/** The bot's desktop in its panel: the screen (view only unless you take over), who operates it, and the bot's request. */
export function DesktopPanel({ t, openStream, frame, connector }: DesktopPanelProps) {
  const screen = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<ScreenSession>()
  useEffect(() => {
    const target = screen.current
    if (target === null) return
    const created = new ScreenSession({
      open: () => openStream(SCREEN_STREAM),
      target,
      page,
      timers,
    })
    setSession(created)
    return () => created.dispose()
  }, [openStream])
  const state = useScreen(session)
  const seconds = useSeconds(state?.status === "disconnected" ? state.retryAt : undefined)
  const connected = state?.status === "connected"
  const self = connected && state.holder === "self"
  const request = state?.request ?? null

  return (
    <div
      className="dsdk-panel"
      data-dsdk-frame={frame.presentation}
      data-dsdk-status={state?.status}
      data-dsdk-holder={state?.holder}
      style={frameStyle(frame, resolutionOf(connector.values))}
    >
      <style>{PANEL_CSS}</style>
      <div className="dsdk-bar">
        <span className="dsdk-status" role="status" data-dsdk-state="">
          <span className="dsdk-dot" data-tone={self ? "self" : connected ? state.holder : "off"} />
          {state === undefined ? "" : statusText(t, state, seconds)}
        </span>
        <span className="dsdk-spacer" />
        {connected && !self && (
          <button
            type="button"
            className="dsdk-button dsdk-primary"
            onClick={() => session?.take()}
          >
            {state.holder === "other" ? t("take.other") : t("take")}
          </button>
        )}
        {self && (
          <>
            <button type="button" className="dsdk-button" onClick={() => session?.ctrlAltDel()}>
              {t("ctrlAltDel")}
            </button>
            <button
              type="button"
              className="dsdk-button dsdk-primary"
              onClick={() => session?.release()}
            >
              {t("release")}
            </button>
          </>
        )}
        {(state?.status === "disconnected" || state?.status === "paused") && (
          <button type="button" className="dsdk-button" onClick={() => session?.connect()}>
            {t("reconnect")}
          </button>
        )}
      </div>
      {request !== null && !self && (
        <div className="dsdk-request" role="alert" data-dsdk-request="">
          <div className="dsdk-request-text">
            <span className="dsdk-request-title">{t("request.title")}</span>
            <span className="dsdk-request-reason">{request.reason}</span>
          </div>
          {connected && (
            <span className="dsdk-request-actions">
              <button
                type="button"
                className="dsdk-button dsdk-primary"
                onClick={() => session?.take()}
              >
                {t("take")}
              </button>
              <button type="button" className="dsdk-button" onClick={() => session?.decline()}>
                {t("decline")}
              </button>
            </span>
          )}
        </div>
      )}
      {self && (
        <p className="dsdk-warning" role="note" data-dsdk-warning="">
          {t("warning.typing")}
        </p>
      )}
      <div
        ref={screen}
        className="dsdk-screen"
        role="img"
        aria-label={t("screen")}
        data-dsdk-screen=""
        data-dsdk-self={self || undefined}
      />
    </div>
  )
}
