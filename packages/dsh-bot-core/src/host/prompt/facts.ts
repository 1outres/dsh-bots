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
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  management(botId: string, sessionId: string): BotManagementFacts | undefined
  botName(botId: string): string | undefined
  channels(): readonly BotPromptChannel[]
  channelStatus(botId: string): readonly BotStatusChannel[]
  connectors(botId: string): readonly BotConnectorView[]
  web(): BotWebStatus
  logins(botId: string): boolean
}

function connectorOf(view: BotConnectorView): BotStatusConnector {
  const accounts = (view.accounts ?? [])
    .filter((account) => account.status === "active" && account.granted)
    .map((account) => account.email ?? account.label)
  return { name: view.connector.name, readiness: view.readiness, accounts }
}

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
      logins: deps.logins(botId),
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
