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

export interface RemoteCaller {
  readonly kind: string
}

export interface DecidingChannel {
  readonly id: string
  readonly name: string
  readonly approvers: ReadonlySet<string>
  readonly signal: AbortSignal
}

export interface ConnectorApprovalsDeps {
  ledger: Pick<ConnectorLedger, "get" | "list" | "all" | "subscribe">
  broker: Pick<ConnectorBroker, "recordDecision">
  catalog: Pick<ConnectorCatalog, "get">
  exists(botId: string): boolean
}

export interface ConnectorApprovals {
  view(action: ConnectorAction): ConnectorActionView
  views(botId: string): readonly ConnectorActionView[]
  open(botId: string): readonly ConnectorActionView[]
  find(botId: string, actionId: string): ConnectorActionView | undefined
  pending(botId: string): readonly ConnectorActionView[]
  pendingFor(botId: string, channel: DecidingChannel, person: string): BotPendingActionsResult
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

  const pending = (botId: string) =>
    deps.ledger
      .list(botId)
      .filter((action) => action.status.state === "pending")
      .map(view)

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
    pending,
    pendingFor(botId, channel, person) {
      if (channel.signal.aborted) return { ok: false, reason: "closed" }
      if (!channel.approvers.has(person)) return { ok: false, reason: "not-approver" }
      return { ok: true, actions: pending(botId) }
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
