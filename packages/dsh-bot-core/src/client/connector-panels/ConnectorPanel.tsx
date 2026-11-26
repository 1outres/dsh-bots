import { type KeyboardEvent, type ReactNode, useMemo } from "react"
import type {
  ConnectorPanelFrame,
  ConnectorPanelProps,
  ConnectorPanelSlot,
} from "../../connector-panel-contract"
import type { BotView } from "../../shared/bots"
import type {
  BotConnectorView,
  ConnectorPanelPresentation,
  ConnectorText,
} from "../../shared/connectors"
import { ConnectorPreparing } from "../connector-preparing"
import type { ConnectorsFeed } from "../connectors-hub"
import type { PanelWidth } from "../files/panel-width"
import { useObservable } from "../hooks"
import { IconAlert } from "../icons"
import { POPOVER_BODY_BOUNDS, PopoverPanelFrame } from "../shell/PopoverPanelFrame"
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

/**
 * Where the panel is drawn: in the side panel frame, which shares the shell's
 * width, or a popover over the app, which `mount` puts in bot-core's
 * `shell.overlay` entry (a portal), hidden while a settings screen is
 * `covered` over it.
 */
export type ConnectorPanelPlacement =
  | {
      readonly presentation: "side"
      readonly width: PanelWidth
      readonly containerRef: { readonly current: HTMLElement | null }
    }
  | {
      readonly presentation: "popover"
      readonly covered: boolean
      mount(popover: ReactNode): ReactNode
    }

const FRAMES: {
  readonly [Presentation in ConnectorPanelPresentation]: Extract<
    ConnectorPanelFrame,
    { readonly presentation: Presentation }
  >
} = {
  side: { presentation: "side" },
  popover: { presentation: "popover", bounds: POPOVER_BODY_BOUNDS },
}

export interface ConnectorPanelViewProps {
  readonly t: Translate
  readonly text: (value: ConnectorText) => string
  readonly bot: BotView
  readonly sessionId: string
  readonly connectorId: string
  readonly placement: ConnectorPanelPlacement
  readonly feed: ConnectorsFeed
  readonly renderSlot: RenderShellSlot
  readonly openStream: OpenConnectorStream
  openSettings(): void
  close(): void
}

/**
 * A connector's panel: the frame its presentation asks for (title, the
 * connector's note, close) around the connector's readiness, or, once it is
 * ready, the body its browser part registers. Escape closes it, except while
 * a person operates the connector (the keys are theirs).
 */
export function ConnectorPanelView(props: ConnectorPanelViewProps) {
  const { t, text, connectorId, placement } = props
  const state = useObservable(props.feed)
  const view =
    state.status === "ready"
      ? state.snapshot.connectors.find((entry) => entry.connector.id === connectorId)
      : undefined
  const panel = view?.connector.panel
  const title = panel === undefined ? connectorId : text(panel.title)
  const note = view?.status.note
  const held = view?.status.operatedBy === "person"
  const trailing = note !== undefined && (
    <span className="dshb-cpanel-note" title={text(note)} data-dshb-cpanel-note="">
      {text(note)}
    </span>
  )
  const closeLabel = t("connectorPanel.close", { title })
  const marks = {
    "data-dshb-connector-panel": connectorId,
    "data-dshb-cpanel-presentation": placement.presentation,
  }
  const content = (
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
  )
  switch (placement.presentation) {
    case "side":
      return (
        <SidePanelFrame
          label={title}
          title={title}
          trailing={trailing}
          closeLabel={closeLabel}
          resizeLabel={t("connectorPanel.resize", { title })}
          onClose={props.close}
          width={placement.width}
          containerRef={placement.containerRef}
          onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
            if (event.key !== "Escape" || event.defaultPrevented || held) return
            event.preventDefault()
            props.close()
          }}
          marks={marks}
        >
          {content}
        </SidePanelFrame>
      )
    case "popover":
      return placement.mount(
        <PopoverPanelFrame
          title={title}
          trailing={trailing}
          closeLabel={closeLabel}
          onClose={props.close}
          held={held}
          covered={placement.covered}
          returnFocusTo={() => [
            `[data-dshb-shell-entry="${CSS.escape(`connector:${connectorId}`)}"]`,
            "[data-dshb-shell-menu-button]",
          ]}
          marks={marks}
        >
          {content}
        </PopoverPanelFrame>,
      )
  }
}

function PanelBody(
  props: ConnectorPanelViewProps & { readonly view: BotConnectorView; readonly title: string },
) {
  const { t, view, title, bot, sessionId, connectorId, openStream, placement } = props
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
            {
              botId: bot.id,
              sessionId,
              connector: view,
              frame: FRAMES[placement.presentation],
              openStream: open,
            },
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
