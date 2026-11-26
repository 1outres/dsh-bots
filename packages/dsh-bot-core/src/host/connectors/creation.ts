import { type BotCreationOptionOffer, validateCreationChoices } from "../../shared/bots"
import {
  BOT_CREATION_OPTIONS,
  type BotCreationOption,
  defaultConnectorSettings,
} from "../../shared/connectors"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import { environmentNeeds } from "./needs"
import { requirementOrder } from "./requirements"
import type { ConnectorSettings } from "./settings"

export interface CreationConnectorsDeps {
  catalog: Pick<ConnectorCatalog, "list">
  settings: Pick<ConnectorSettings, "configure" | "purge">
}

export interface CreationConnectors {
  offer(): readonly BotCreationOptionOffer[]
  select(input: unknown): readonly CatalogConnector[]
  enable(botId: string, connectors: readonly CatalogConnector[]): Promise<void>
}

export function createCreationConnectors(deps: CreationConnectorsDeps): CreationConnectors {
  const of = (option: BotCreationOption) =>
    deps.catalog.list().filter((connector) => connector.creationOption === option)

  return {
    offer() {
      return BOT_CREATION_OPTIONS.flatMap((option) => {
        const connectors = of(option)
        if (connectors.length === 0) return []
        return [{ option, needs: environmentNeeds(connectors, () => true) }]
      })
    },
    select(input) {
      const choices = validateCreationChoices(input)
      return BOT_CREATION_OPTIONS.flatMap((option) => {
        if (!choices[option]) return []
        const connectors = of(option)
        if (connectors.length === 0) {
          throw new Error(`no registered connector offers the ${option} option`)
        }
        return connectors
      })
    },
    async enable(botId, connectors) {
      try {
        for (const connector of requirementOrder(connectors)) {
          await deps.settings.configure(botId, connector, {
            enabled: true,
            values: defaultConnectorSettings(connector.settings ?? []),
            ...(connector.events === undefined ? {} : { events: "off" }),
          })
        }
      } catch (error) {
        await deps.settings.purge((id) => id !== botId)
        throw error
      }
    },
  }
}
