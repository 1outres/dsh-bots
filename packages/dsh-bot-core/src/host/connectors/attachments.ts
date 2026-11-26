import type { BotConnectorAttachment, BotConnectorContext } from "../../connector-contract"
import type { CatalogConnector } from "./catalog"

export interface ConnectorAttachmentsDeps {
  warn(message: string): void
}

export interface ConnectorAttachments {
  get(
    botId: string,
    connector: CatalogConnector,
    context: (signal: AbortSignal) => BotConnectorContext,
  ): Promise<unknown>
  release(botId: string, connectorId?: string): void
  dispose(): Promise<void>
}

interface Held {
  readonly connectorId: string
  readonly botId: string
  readonly lifetime: AbortController
  readonly opened: Promise<BotConnectorAttachment<unknown>>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createConnectorAttachments(deps: ConnectorAttachmentsDeps): ConnectorAttachments {
  const held = new Map<string, Held>()
  const keyOf = (botId: string, connectorId: string) => `${botId}\u0000${connectorId}`

  const close = (key: string, entry: Held): Promise<void> => {
    if (held.get(key) === entry) held.delete(key)
    entry.lifetime.abort()
    return entry.opened.then(
      (resource) =>
        resource.dispose().catch((error: unknown) => {
          deps.warn(
            `bot-core: could not dispose connector "${entry.connectorId}"'s resource of bot "${entry.botId}": ${messageOf(error)}`,
          )
        }),
      () => {},
    )
  }

  return {
    async get(botId, connector, context) {
      const attachment = connector.attachment
      if (attachment === undefined) return undefined
      const key = keyOf(botId, connector.id)
      let entry = held.get(key)
      if (entry === undefined) {
        const lifetime = new AbortController()
        const opened = Promise.resolve().then(() => attachment.open(context(lifetime.signal)))
        const created: Held = { connectorId: connector.id, botId, lifetime, opened }
        entry = created
        held.set(key, created)
        opened.then(
          (resource) => {
            void resource.ended?.then(
              () => {
                if (held.get(key) === created) held.delete(key)
              },
              () => {
                if (held.get(key) === created) held.delete(key)
              },
            )
          },
          () => {
            if (held.get(key) === created) held.delete(key)
          },
        )
      }
      return (await entry.opened).value
    },
    release(botId, connectorId) {
      for (const [key, entry] of [...held]) {
        if (
          entry.botId !== botId ||
          (connectorId !== undefined && entry.connectorId !== connectorId)
        )
          continue
        void close(key, entry)
      }
    },
    async dispose() {
      await Promise.all([...held].map(([key, entry]) => close(key, entry)))
    },
  }
}
