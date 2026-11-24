import type {
  BotManagementFacts,
  BotPromptChannel,
  BotPromptFacts,
  BotStatusChannel,
  BotStatusConnector,
} from "../../internal"
import type { BotConnectorView } from "../../shared/connectors"
import type { BotWebStatus } from "../../shared/web"
import { type KindAgent, type SessionKindDeps, sessionKindOf } from "./session-kind"

export interface PromptFactsDeps<A extends KindAgent> {
  /** Whether `token` is the token of a revision of the bot's preset registered during this load. */
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  /** The bot the Agent's session verifiably belongs to (host/preset/identity.ts). */
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  /** How the Main session manages the session now, if it does. */
  management(botId: string, sessionId: string): BotManagementFacts | undefined
  /** The stored bot's name, or undefined when it is not stored. */
  botName(botId: string): string | undefined
  /** Every registered channel, with its formatting line. */
  channels(): readonly BotPromptChannel[]
  /** The bot's channels its settings turn on, with their status and owners. */
  channelStatus(botId: string): readonly BotStatusChannel[]
  connectors(botId: string): readonly BotConnectorView[]
  web(): BotWebStatus
}

function connectorOf(view: BotConnectorView): BotStatusConnector {
  const accounts = (view.accounts ?? [])
    .filter((account) => account.status === "active" && account.granted)
    .map((account) => account.email ?? account.label)
  return { name: view.connector.name, readiness: view.readiness, accounts }
}

/** What bot-core's prompt row says to each Agent of a bot (src/plugins/prompt.ts). */
export function createPromptFacts<A extends KindAgent>(deps: PromptFactsDeps<A>) {
  return (botId: string, token: string, agentId: string): BotPromptFacts => {
    if (!deps.sealed(botId, token)) {
      throw new Error(
        `bot-core: this preset revision of bot "${botId}" was not registered by this bot-core`,
      )
    }
    const agent = deps.agent(agentId)
    if (agent === undefined || deps.botOf(agent) !== botId) {
      throw new Error(`bot-core: Agent "${agentId}" does not run a session of bot "${botId}"`)
    }
    const botName = deps.botName(botId)
    if (botName === undefined) throw new Error(`bot-core: bot "${botId}" does not exist`)
    const session = sessionKindOf(deps.kind, botId, agent)
    const management =
      session === "main" || session === "subagent" || session === "curator"
        ? undefined
        : deps.management(botId, agent.id)
    return {
      botName,
      session,
      ...(management === undefined ? {} : { management }),
      channels: deps.channels(),
      status: {
        channels: deps.channelStatus(botId),
        connectors: deps
          .connectors(botId)
          .filter((view) => view.enabled)
          .map(connectorOf),
        web: deps.web(),
      },
    }
  }
}
