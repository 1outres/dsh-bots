import type { BotEnvironmentNeed } from "../../shared/environment"
import type { CatalogConnector } from "./catalog"

export function environmentNeeds(
  connectors: readonly CatalogConnector[],
  enabled: (connectorId: string) => boolean,
): readonly BotEnvironmentNeed[] {
  return connectors.flatMap((connector) =>
    connector.minimumSpec !== undefined &&
    Object.keys(connector.minimumSpec).length > 0 &&
    enabled(connector.id)
      ? [{ connector: connector.name, minimum: { ...connector.minimumSpec } }]
      : [],
  )
}
