import type { ConnectionServiceView } from "../../shared/connections"
import type { ConnectorCatalog } from "../connectors/catalog"

/** The registered connectors each provider's accounts serve. */
export interface ConnectionServices {
  of(provider: string): readonly ConnectionServiceView[]
}

export function createConnectionServices(
  catalog: Pick<ConnectorCatalog, "list">,
): ConnectionServices {
  return {
    of: (provider) =>
      catalog.list().flatMap((connector) =>
        connector.connections?.provider === provider
          ? [
              {
                connectorId: connector.id,
                name: connector.name,
                scopes: [...connector.connections.scopes],
              },
            ]
          : [],
      ),
  }
}
