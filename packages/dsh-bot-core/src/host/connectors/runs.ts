import type {
  BotConnectorConnection,
  BotConnectorContext,
  BotConnectorEnvironment,
  BotConnectorRun,
  BotConnectorSenders,
  BotConnectorTrigger,
} from "../../connector-contract"
import type { ConnectionRecord } from "../connections/domain"
import type { VaultAccessContext, VaultRun } from "../vaults/access"
import type { ConnectorAttachments } from "./attachments"
import type { CatalogConnector, CatalogTool } from "./catalog"
import type { RunImages } from "./images"
import type { ConnectorSettings } from "./settings"

export interface PreparedRun {
  readonly run: BotConnectorRun<unknown>
  readonly images?: RunImages
  release(): void
}

export interface RunPurpose {
  readonly kind: "execute" | "snapshot"
  readonly callerSessionId?: string
  readonly connection?: ConnectionRecord
}

export interface ConnectorRunsDeps {
  bot(botId: string): { readonly id: string; readonly name: string } | undefined
  settings: Pick<ConnectorSettings, "view">
  environment(botId: string): BotConnectorEnvironment
  attachments: Pick<ConnectorAttachments, "get">
  images(sessionId: string, signal: AbortSignal): RunImages
  connection(record: ConnectionRecord): BotConnectorConnection
  senders(connectionId: string): BotConnectorSenders
  vault(context: VaultAccessContext): VaultRun
}

export interface ConnectorRuns {
  context(
    botId: string,
    connector: CatalogConnector,
    signal: AbortSignal,
  ): BotConnectorContext | undefined
  prepare(
    botId: string,
    entry: CatalogTool,
    trigger: BotConnectorTrigger,
    signal: AbortSignal,
    purpose: RunPurpose,
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
    async prepare(botId, entry, trigger, signal, purpose) {
      const { callerSessionId, connection } = purpose
      const { connector } = entry
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
      const vault =
        purpose.kind === "execute" && entry.tool.vault === true
          ? deps.vault({
              botId,
              connector: connector.id,
              tool: entry.name,
              ...(callerSessionId === undefined ? {} : { sessionId: callerSessionId }),
              signal,
            })
          : undefined
      const run: BotConnectorRun<unknown> = {
        ...base,
        trigger,
        attachment,
        ...(images === undefined || callerSessionId === undefined
          ? {}
          : { caller: { sessionId: callerSessionId, images: images.images } }),
        ...(connection === undefined ? {} : { connection: deps.connection(connection) }),
        ...(connection === undefined || connector.senders === undefined
          ? {}
          : { senders: deps.senders(connection.id) }),
        ...(vault === undefined ? {} : { vault: vault.access }),
      }
      const release = () => vault?.release()
      return images === undefined ? { run, release } : { run, images, release }
    },
  }
}
