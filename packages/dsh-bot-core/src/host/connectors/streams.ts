/**
 * The streams connectors' panels open for a person (`BotConnectorPanel.streams`,
 * the `botConnectorStreams` Remote): only the DSH Host's owner opens one, only
 * while the connector is ready for the bot, at most
 * {@link MAX_CONNECTOR_STREAMS} at once per bot and connector. Each ends when
 * its viewer leaves or the connector leaves `ready` for the bot (released).
 */
import type { BotConnectorContext } from "../../connector-contract"
import { type ConnectorJson, MAX_CONNECTOR_STREAMS } from "../../shared/connectors"
import type { RemoteCaller } from "./approvals"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import type { ConnectorReadinessKeeper } from "./readiness"

export interface ConnectorStreamsDeps {
  catalog: Pick<ConnectorCatalog, "get">
  readiness: Pick<ConnectorReadinessKeeper, "state">
  /** Whether the bot is stored. */
  exists(botId: string): boolean
  /** The context of a hook for the bot, or undefined once the bot is gone. */
  context(
    botId: string,
    connector: CatalogConnector,
    signal: AbortSignal,
  ): BotConnectorContext | undefined
}

export interface ConnectorStreamRequest {
  readonly caller: RemoteCaller | undefined
  readonly botId: string
  readonly connectorId: string
  readonly stream: string
  /** The browser's items, as the Gateway delivers them. */
  readonly uplink: AsyncIterable<unknown>
  /** The viewer's cancellation. */
  readonly signal: AbortSignal
}

export interface ConnectorStreams {
  /** @throws before the first item when the caller, the bot, the connector or its readiness refuses it. */
  open(request: ConnectorStreamRequest): AsyncIterable<ConnectorJson>
  /** End the bot's streams of the connector (or of every connector). */
  release(botId: string, connectorId?: string): void
  /** The number of streams open for the bot and connector. */
  count(botId: string, connectorId: string): number
  /** End every stream. */
  dispose(): void
}

interface Held {
  readonly botId: string
  readonly connectorId: string
  readonly lifetime: AbortController
}

function parsed(
  source: AsyncIterator<unknown>,
  parse: (item: unknown) => unknown,
): AsyncIterable<unknown> {
  const iterator: AsyncIterator<unknown> = {
    async next() {
      const next = await source.next()
      return next.done ? next : { done: false, value: parse(next.value) }
    },
    async return() {
      await source.return?.()
      return { done: true, value: undefined }
    },
  }
  return { [Symbol.asyncIterator]: () => iterator }
}

export function createConnectorStreams(deps: ConnectorStreamsDeps): ConnectorStreams {
  const held = new Set<Held>()
  const of = (botId: string, connectorId: string) =>
    [...held].filter((entry) => entry.botId === botId && entry.connectorId === connectorId)

  const admit = (request: ConnectorStreamRequest) => {
    const { botId, connectorId, stream } = request
    if (request.caller?.kind !== "owner") {
      throw new Error("only the owner of the DSH Host may open a connector's stream")
    }
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
    const connector = deps.catalog.get(connectorId)
    if (connector === undefined) throw new Error(`connector "${connectorId}" is not registered`)
    const definition = connector.panel?.streams.find((entry) => entry.name === stream)
    if (definition === undefined) {
      throw new Error(`${connector.name} has no stream "${stream}"`)
    }
    if (deps.readiness.state(botId, connectorId).state !== "ready") {
      throw new Error(`${connector.name} is not ready for this bot`)
    }
    if (of(botId, connectorId).length >= MAX_CONNECTOR_STREAMS) {
      throw new Error(
        `${connector.name} already has ${MAX_CONNECTOR_STREAMS} streams open for this bot`,
      )
    }
    return { connector, definition }
  }

  return {
    async *open(request) {
      const { connector, definition } = admit(request)
      const entry: Held = {
        botId: request.botId,
        connectorId: request.connectorId,
        lifetime: new AbortController(),
      }
      held.add(entry)
      const signal = AbortSignal.any([request.signal, entry.lifetime.signal])
      const source = request.uplink[Symbol.asyncIterator]()
      try {
        const context = deps.context(request.botId, connector, signal)
        if (context === undefined) throw new Error("the bot no longer exists")
        const uplink = parsed(source, (item) => definition.parse(item))
        for await (const item of definition.open({ ...context, uplink })) {
          if (signal.aborted) return
          yield item
        }
      } finally {
        held.delete(entry)
        entry.lifetime.abort()
        await source.return?.()
      }
    },
    release(botId, connectorId) {
      for (const entry of [...held]) {
        if (entry.botId !== botId) continue
        if (connectorId !== undefined && entry.connectorId !== connectorId) continue
        entry.lifetime.abort()
      }
    },
    count: (botId, connectorId) => of(botId, connectorId).length,
    dispose() {
      for (const entry of [...held]) entry.lifetime.abort()
    },
  }
}
