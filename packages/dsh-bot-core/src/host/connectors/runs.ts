/**
 * What one run of a connector tool gets (`BotConnectorRun`): the bot, its
 * settings, its environment, the connector's resident resource and, for a
 * call, the caller's images.
 */
import type {
  BotConnectorConnection,
  BotConnectorContext,
  BotConnectorEnvironment,
  BotConnectorRun,
  BotConnectorTrigger,
} from "../../connector-contract"
import type { ConnectionRecord } from "../connections/domain"
import type { ConnectorAttachments } from "./attachments"
import type { CatalogConnector } from "./catalog"
import type { RunImages } from "./images"
import type { ConnectorSettings } from "./settings"

/** A run ready to go, with the images the caller may get back. */
export interface PreparedRun {
  readonly run: BotConnectorRun<unknown>
  readonly images?: RunImages
}

export interface ConnectorRunsDeps {
  bot(botId: string): { readonly id: string; readonly name: string } | undefined
  settings: Pick<ConnectorSettings, "view">
  environment(botId: string): BotConnectorEnvironment
  attachments: Pick<ConnectorAttachments, "get">
  images(sessionId: string, signal: AbortSignal): RunImages
  /** The account a run acts as. */
  connection(record: ConnectionRecord): BotConnectorConnection
}

export interface ConnectorRuns {
  /** The context of a connector hook for the bot, or undefined once the bot is gone. */
  context(
    botId: string,
    connector: CatalogConnector,
    signal: AbortSignal,
  ): BotConnectorContext | undefined
  /**
   * A run of one of the connector's tools; opens its resident resource first.
   * @throws when the bot is gone or the resource cannot be opened.
   */
  prepare(
    botId: string,
    connector: CatalogConnector,
    trigger: BotConnectorTrigger,
    signal: AbortSignal,
    callerSessionId?: string,
    connection?: ConnectionRecord,
  ): Promise<PreparedRun>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createConnectorRuns(deps: ConnectorRunsDeps): ConnectorRuns {
  const context = (botId: string, connector: CatalogConnector, signal: AbortSignal) => {
    const bot = deps.bot(botId)
    if (bot === undefined) return undefined
    return {
      bot: { id: bot.id, name: bot.name },
      settings: deps.settings.view(botId, connector).values,
      environment: deps.environment(botId),
      signal,
    }
  }
  return {
    context,
    async prepare(botId, connector, trigger, signal, callerSessionId, connection) {
      const base = context(botId, connector, signal)
      if (base === undefined) throw new Error("the bot no longer exists")
      let attachment: unknown
      try {
        attachment = await deps.attachments.get(botId, connector, (lifetime) => ({
          ...base,
          signal: lifetime,
        }))
      } catch (error) {
        throw new Error(`${connector.name} could not start for this bot: ${messageOf(error)}`)
      }
      const images =
        callerSessionId === undefined ? undefined : deps.images(callerSessionId, signal)
      const run: BotConnectorRun<unknown> = {
        ...base,
        trigger,
        attachment,
        ...(images === undefined || callerSessionId === undefined
          ? {}
          : { caller: { sessionId: callerSessionId, images: images.images } }),
        ...(connection === undefined ? {} : { connection: deps.connection(connection) }),
      }
      return images === undefined ? { run } : { run, images }
    },
  }
}
