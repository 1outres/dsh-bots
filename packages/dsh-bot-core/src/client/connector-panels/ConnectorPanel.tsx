import { type ReactNode, useMemo } from "react"
import type { ConnectorPanelProps, ConnectorPanelSlot } from "../../connector-panel-contract"
import type { BotView } from "../../shared/bots"
import type { BotConnectorView, ConnectorText } from "../../shared/connectors"
import { ConnectorPreparing } from "../connector-preparing"
import type { ConnectorsFeed } from "../connectors-hub"
import type { PanelWidth } from "../files/panel-width"
import { useObservable } from "../hooks"
import { IconAlert } from "../icons"
import { SidePanelFrame } from "../shell/SidePanelFrame"
import type { Translate } from "../types"
import { Button, EmptyState, ErrorText, Group } from "../ui"
import type { OpenConnectorStream } from "./face"
import { CONNECTOR_PANEL_GLYPHS } from "./icons"

export const CONNECTOR_PANEL_SLOT: ConnectorPanelSlot = "bot-core.connector.panel"

/** `renderSlot` for the shell's declared child Slots. */
export type RenderShellSlot = (
  key: ConnectorPanelSlot,
  owner: ConnectorPanelProps,
  options: { readonly entryKey: string; readonly fallback: ReactNode },
) => ReactNode

export interface ConnectorPanelViewProps {
  readonly t: Translate
  readonly text: (value: ConnectorText) => string
  readonly bot: BotView
  readonly sessionId: string
  readonly connectorId: string
  readonly feed: ConnectorsFeed
  readonly width: PanelWidth
  readonly containerRef: { readonly current: HTMLElement | null }
  readonly renderSlot: RenderShellSlot
  readonly openStream: OpenConnectorStream
  openSettings(): void
  close(): void
}

/**
 * A connector's panel beside the chat: the shell's panel frame (title, the
 * connector's note, close, resize) around the connector's readiness, or,
 * once it is ready, the body its browser part registers.
 */
export function ConnectorPanelView(props: ConnectorPanelViewProps) {
  const { t, text, feed, connectorId } = props
  const state = useObservable(feed)
  const view =
    state.status === "ready"
      ? state.snapshot.connectors.find((entry) => entry.connector.id === connectorId)
      : undefined
  const panel = view?.connector.panel
  const title = panel === undefined ? connectorId : text(panel.title)
  const note = view?.status.note
  return (
    <SidePanelFrame
      label={title}
      title={title}
      trailing={
        note !== undefined && (
          <span className="dshb-cpanel-note" title={text(note)} data-dshb-cpanel-note="">
            {text(note)}
          </span>
        )
      }
      closeLabel={t("connectorPanel.close", { title })}
      resizeLabel={t("connectorPanel.resize", { title })}
      onClose={props.close}
      width={props.width}
      containerRef={props.containerRef}
      marks={{ "data-dshb-connector-panel": connectorId }}
    >
      <div className="dshb-cpanel-body">
        {state.status === "loading" && <p className="dshb-panel-note">{t("files.loading")}</p>}
        {state.status === "failed" && (
          <div className="dshb-panel-note">
            <ErrorText>
              {t("connectorPanel.feedFailed", { message: state.failure.message })}
            </ErrorText>
          </div>
        )}
        {state.status === "ready" && (view === undefined || panel === undefined) && (
          <EmptyState
            icon={<IconAlert size={28} />}
            title={t("connectorPanel.gone", { title })}
            marks={{ "data-dshb-cpanel-state": "gone" }}
          />
        )}
        {view !== undefined && panel !== undefined && (
          <PanelBody {...props} view={view} title={title} />
        )}
      </div>
    </SidePanelFrame>
  )
}

function PanelBody(
  props: ConnectorPanelViewProps & { readonly view: BotConnectorView; readonly title: string },
) {
  const { t, view, title, bot, sessionId, connectorId, openStream } = props
  const open = useMemo(
    () => (name: string) => openStream(bot.id, connectorId, name),
    [openStream, bot.id, connectorId],
  )
  const { readiness, connector } = view
  const Glyph =
    connector.panel === undefined ? IconAlert : CONNECTOR_PANEL_GLYPHS[connector.panel.icon]
  const icon = <Glyph size={28} />
  switch (readiness.state) {
    case "disabled":
      return (
        <EmptyState
          icon={icon}
          title={t("connectorPanel.disabled", { title })}
          action={
            <Button variant="secondary" onClick={props.openSettings}>
              {t("connectorPanel.openSettings")}
            </Button>
          }
          marks={{ "data-dshb-cpanel-state": "disabled" }}
        />
      )
    case "unavailable":
      return (
        <EmptyState
          icon={icon}
          title={t(`connectorPanel.unavailable.${readiness.cause}`, { title })}
          detail={readiness.reason}
          marks={{ "data-dshb-cpanel-state": "unavailable" }}
        />
      )
    case "preparing": {
      const hint = connector.preparation?.hint
      return (
        <EmptyState
          icon={icon}
          title={hint === undefined ? t("connectorPanel.preparing", { title }) : props.text(hint)}
          detail={
            <Group>
              <ConnectorPreparing t={t} text={props.text} readiness={readiness} />
            </Group>
          }
          marks={{ "data-dshb-cpanel-state": "preparing" }}
        />
      )
    }
    case "failed":
      return (
        <EmptyState
          icon={icon}
          title={t("connectorPanel.failed", { title })}
          detail={<ErrorText>{readiness.reason}</ErrorText>}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                props.feed.retry(connectorId).catch((error: unknown) => {
                  console.error(`bot-core: retrying connector "${connectorId}" failed`, error)
                })
              }}
            >
              {t("connectorPanel.retry")}
            </Button>
          }
          marks={{ "data-dshb-cpanel-state": "failed" }}
        />
      )
    case "ready":
      return (
        <>
          {props.renderSlot(
            CONNECTOR_PANEL_SLOT,
            { botId: bot.id, sessionId, connector: view, openStream: open },
            {
              entryKey: connectorId,
              fallback: (
                <EmptyState
                  icon={icon}
                  title={t("connectorPanel.missing", { title })}
                  marks={{ "data-dshb-cpanel-state": "missing" }}
                />
              ),
            },
          )}
        </>
      )
  }
}
