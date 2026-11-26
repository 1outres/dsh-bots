import type {
  ConnectorPanelIcon,
  ConnectorPanelPresentation,
  ConnectorRequest,
  ConnectorText,
} from "../../shared/connectors"
import type { ConnectorsState } from "../connectors-model"
import type { Translate } from "../types"
import { Button, Group, Row } from "../ui"
import { CONNECTOR_PANEL_GLYPHS } from "./icons"
import type { ConnectorPanelPlaces } from "./places"

export interface OpenRequest {
  readonly connectorId: string
  readonly title: string
  readonly icon: ConnectorPanelIcon
  readonly presentation: ConnectorPanelPresentation
  readonly request: ConnectorRequest
}

/** What the bot asks a person to do through its connectors' panels, until each connector clears it. */
export function requestsOf(
  state: ConnectorsState,
  text: (value: ConnectorText) => string,
): readonly OpenRequest[] {
  if (state.status !== "ready") return []
  return state.snapshot.connectors.flatMap((view) => {
    const { request } = view.status
    const panel = view.connector.panel
    return request === undefined || panel === undefined
      ? []
      : [
          {
            connectorId: view.connector.id,
            title: text(panel.title),
            icon: panel.icon,
            presentation: panel.presentation,
            request,
          },
        ]
  })
}

/**
 * The requests at the top of the Actions panel: the bot's reason (its words,
 * shown as text only) and a button that opens the connector's panel.
 */
export function ConnectorRequests(props: {
  readonly t: Translate
  readonly sessionId: string
  readonly requests: readonly OpenRequest[]
  readonly places: ConnectorPanelPlaces
}) {
  const { t, sessionId, requests, places } = props
  if (requests.length === 0) return null
  return (
    <Group marks={{ "data-dshb-connector-requests": "" }}>
      {requests.map(({ connectorId, title, icon, presentation, request }) => {
        const Glyph = CONNECTOR_PANEL_GLYPHS[icon]
        return (
          <Row
            key={request.id}
            leading={<Glyph size={16} />}
            label={request.reason}
            meta={title}
            description={request.reason}
            trailing={
              <Button
                variant="row"
                marks={{ "data-dshb-connector-request-open": connectorId }}
                onClick={() => places[presentation].open(sessionId, connectorId)}
              >
                {t("connectorRequest.open", { title })}
              </Button>
            }
          />
        )
      })}
    </Group>
  )
}
