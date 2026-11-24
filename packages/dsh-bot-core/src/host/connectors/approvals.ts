import type { BotPendingActionsResult } from "../../channel-contract"
import {
  type ConnectorAction,
  type ConnectorActionView,
  type ConnectorDecisionOrigin,
  type ConnectorDecisionResult,
  connectorToolName,
} from "../../shared/connectors"
import { isOpen } from "./action"
import type { ConnectorBroker } from "./broker"
import type { ConnectorCatalog } from "./catalog"
import { decisionInputSchema } from "./domain"
import type { ConnectorLedger } from "./ledger"

/** Who calls a Remote method, as DSH's Gateway names the Peer's principal. */
export interface RemoteCaller {
  readonly kind: string
}

/** A channel connection of a bot, as its link decides through it. */
export interface DecidingChannel {
  readonly id: string
  readonly name: string
  /** The channel's ids of the people the bot's settings of the channel let decide. */
  readonly approvers: ReadonlySet<string>
  /** Aborted once the connection is closing. */
  readonly signal: AbortSignal
}

export interface ConnectorApprovalsDeps {
  ledger: Pick<ConnectorLedger, "get" | "list" | "all" | "subscribe">
  broker: Pick<ConnectorBroker, "recordDecision">
  catalog: Pick<ConnectorCatalog, "get">
  /** Whether the bot is stored. */
  exists(botId: string): boolean
}

/**
 * The only way a person's decision reaches the ledger (design rule 46). A
 * decision is taken from the bot's owner alone: in the Web UI, a Remote call
 * of the DSH Host's owner; through a channel, one of the approvers the bot's
 * settings of that channel name (none by default: nobody decides there).
 */
export interface ConnectorApprovals {
  view(action: ConnectorAction): ConnectorActionView
  /** @throws for an unknown bot. */
  views(botId: string): readonly ConnectorActionView[]
  /** The bot's actions that are pending, approved or running. */
  open(botId: string): readonly ConnectorActionView[]
  /** The bot's action; undefined for an action the ledger does not keep, or another bot's. */
  find(botId: string, actionId: string): ConnectorActionView | undefined
  /** The bot's pending actions, oldest first, for one of the channel's approvers. */
  pendingFor(botId: string, channel: DecidingChannel, person: string): BotPendingActionsResult
  /** Pending actions per bot that has any. */
  waiting(): Readonly<Record<string, number>>
  fromWeb(
    caller: RemoteCaller | undefined,
    botId: string,
    actionId: string,
    decision: unknown,
  ): Promise<ConnectorDecisionResult>
  fromChannel(
    botId: string,
    channel: DecidingChannel,
    person: string,
    actionId: string,
    decision: unknown,
  ): Promise<ConnectorDecisionResult>
  /** Called with every created or changed action. */
  subscribe(listener: (action: ConnectorActionView) => void): () => void
}

export function createConnectorApprovals(deps: ConnectorApprovalsDeps): ConnectorApprovals {
  const view = (action: ConnectorAction): ConnectorActionView => {
    const name = deps.catalog.get(action.connectorId)?.name
    return {
      id: action.id,
      botId: action.botId,
      connector: { id: action.connectorId, ...(name === undefined ? {} : { name }) },
      tool: action.tool,
      toolName: connectorToolName(action.connectorId, action.tool),
      args: action.args,
      preview: action.preview,
      createdAt: action.createdAt,
      expiresAt: action.expiresAt,
      status: action.status,
    }
  }

  const decide = async (
    botId: string,
    actionId: string,
    input: unknown,
    origin: ConnectorDecisionOrigin,
  ): Promise<ConnectorDecisionResult> => {
    const decision = decisionInputSchema.safeParse(input)
    if (!decision.success) throw new Error("a decision is approve or reject")
    const outcome = await deps.broker.recordDecision({
      botId,
      actionId,
      decision: decision.data,
      origin,
    })
    if (outcome.ok) return { accepted: true, action: view(outcome.action) }
    if (outcome.code === "not-found") return { accepted: false, reason: "not-found" }
    const current = deps.ledger.get(actionId) ?? outcome.action
    return { accepted: false, reason: "settled", action: view(current) }
  }

  return {
    view,
    views(botId) {
      if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
      return deps.ledger.list(botId).map(view)
    },
    open: (botId) => deps.ledger.list(botId).filter(isOpen).map(view),
    find(botId, actionId) {
      const action = deps.ledger.get(actionId)
      return action?.botId === botId ? view(action) : undefined
    },
    pendingFor(botId, channel, person) {
      if (channel.signal.aborted) return { ok: false, reason: "closed" }
      if (!channel.approvers.has(person)) return { ok: false, reason: "not-approver" }
      const actions = deps.ledger
        .list(botId)
        .filter((action) => action.status.state === "pending")
        .map(view)
      return { ok: true, actions }
    },
    waiting() {
      const counts: Record<string, number> = {}
      for (const action of deps.ledger.all()) {
        if (action.status.state !== "pending") continue
        counts[action.botId] = (counts[action.botId] ?? 0) + 1
      }
      return counts
    },
    async fromWeb(caller, botId, actionId, decision) {
      if (caller?.kind !== "owner") return { accepted: false, reason: "not-approver" }
      return decide(botId, actionId, decision, { kind: "web" })
    },
    async fromChannel(botId, channel, person, actionId, decision) {
      if (channel.signal.aborted) return { accepted: false, reason: "closed" }
      if (!channel.approvers.has(person)) return { accepted: false, reason: "not-approver" }
      return decide(botId, actionId, decision, {
        kind: "channel",
        channelId: channel.id,
        channelName: channel.name,
        person,
      })
    },
    subscribe: (listener) => deps.ledger.subscribe(({ action }) => listener(view(action))),
  }
}
