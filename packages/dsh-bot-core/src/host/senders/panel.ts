import type { BotConnectorConnection } from "../../connector-contract"
import {
  type BotSendersSnapshot,
  MAX_SENDER_RECIPIENT_SCAN,
  normalizeSenderAddress,
  type SenderPolicyView,
  type SenderRecipient,
  type SenderRecipientsView,
} from "../../shared/senders"
import type { ConnectionRecord } from "../connections/domain"
import type { ConnectionStore } from "../connections/store"
import type { RemoteCaller } from "../connectors/approvals"
import type { ConnectorCatalog } from "../connectors/catalog"
import type { SenderPolicies } from "./policies"

export interface SenderPanelDeps {
  policies: SenderPolicies
  connections: Pick<ConnectionStore, "get" | "list">
  catalog: Pick<ConnectorCatalog, "get">
  account(connectionId: string): string
  connection(record: ConnectionRecord): BotConnectorConnection
  deadline(ms: number): AbortSignal
}

export interface SenderPanel {
  snapshot(): BotSendersSnapshot
  view(connectionId: string): SenderPolicyView
  setUnknown(
    caller: RemoteCaller | undefined,
    connectionId: string,
    unknown: unknown,
  ): Promise<SenderPolicyView>
  putRules(
    caller: RemoteCaller | undefined,
    connectionId: string,
    rules: unknown,
  ): Promise<SenderPolicyView>
  removeRule(
    caller: RemoteCaller | undefined,
    connectionId: string,
    match: unknown,
  ): Promise<SenderPolicyView>
  copy(
    caller: RemoteCaller | undefined,
    fromConnectionId: string,
    toConnectionId: string,
  ): Promise<SenderPolicyView>
  recipients(
    caller: RemoteCaller | undefined,
    connectorId: string,
    connectionId: string,
    signal: AbortSignal | undefined,
  ): Promise<SenderRecipientsView>
}

const RECIPIENTS_TIMEOUT_MS = 60_000
const MAX_NAME = 200

function owner(caller: RemoteCaller | undefined) {
  if (caller?.kind !== "owner") throw new Error("only the DSH owner changes sender policies")
}

function recipientsOf(result: unknown): { scanned: number; recipients: SenderRecipient[] } {
  const value = result as { scanned?: unknown; recipients?: unknown } | null
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isSafeInteger(value.scanned) ||
    !Array.isArray(value.recipients)
  ) {
    throw new Error("the connector listed no recipients")
  }
  const byAddress = new Map<string, SenderRecipient>()
  for (const item of value.recipients as unknown[]) {
    const entry = item as { address?: unknown; name?: unknown; messages?: unknown } | null
    if (typeof entry?.address !== "string" || !Number.isSafeInteger(entry.messages)) continue
    const address = normalizeSenderAddress(entry.address)
    if (address === undefined) continue
    const name =
      typeof entry.name === "string" && entry.name.trim() !== ""
        ? entry.name.trim().slice(0, MAX_NAME)
        : undefined
    const previous = byAddress.get(address)
    byAddress.set(address, {
      address,
      messages: (previous?.messages ?? 0) + (entry.messages as number),
      ...((previous?.name ?? name) === undefined ? {} : { name: previous?.name ?? name }),
    })
  }
  return {
    scanned: value.scanned as number,
    recipients: [...byAddress.values()].sort(
      (a, b) => b.messages - a.messages || a.address.localeCompare(b.address),
    ),
  }
}

export function createSenderPanel(deps: SenderPanelDeps): SenderPanel {
  const requireConnection = (connectionId: string) => {
    const record = deps.connections.get(connectionId)
    if (record === undefined) throw new Error(`no account "${connectionId}"`)
    return record
  }
  const view = (connectionId: string): SenderPolicyView => {
    const policy = deps.policies.policy(connectionId)
    return {
      connectionId,
      account: deps.account(connectionId),
      ...(policy === undefined ? {} : { policy }),
      inquiries: deps.policies
        .inquiries()
        .filter(
          (record) => record.connectionId === connectionId && record.status.state === "pending",
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(deps.policies.view),
    }
  }
  return {
    snapshot: () => ({ accounts: deps.connections.list().map((record) => view(record.id)) }),
    view(connectionId) {
      requireConnection(connectionId)
      return view(connectionId)
    },
    async setUnknown(caller, connectionId, unknown) {
      owner(caller)
      requireConnection(connectionId)
      await deps.policies.setUnknown(connectionId, unknown)
      return view(connectionId)
    },
    async putRules(caller, connectionId, rules) {
      owner(caller)
      requireConnection(connectionId)
      await deps.policies.putRules(connectionId, rules, { kind: "web" })
      return view(connectionId)
    },
    async removeRule(caller, connectionId, match) {
      owner(caller)
      requireConnection(connectionId)
      await deps.policies.removeRule(connectionId, match)
      return view(connectionId)
    },
    async copy(caller, fromConnectionId, toConnectionId) {
      owner(caller)
      requireConnection(fromConnectionId)
      requireConnection(toConnectionId)
      await deps.policies.copy(fromConnectionId, toConnectionId)
      return view(toConnectionId)
    },
    async recipients(caller, connectorId, connectionId, signal) {
      owner(caller)
      const record = requireConnection(connectionId)
      const connector = deps.catalog.get(connectorId)
      if (connector?.senders === undefined) {
        throw new Error(`connector "${connectorId}" has no senders`)
      }
      if (!record.services.includes(connectorId)) {
        throw new Error(`the account does not give ${connector.name} access`)
      }
      const deadline = deps.deadline(RECIPIENTS_TIMEOUT_MS)
      const result: unknown = await connector.senders.recipients({
        connection: deps.connection(record),
        limit: MAX_SENDER_RECIPIENT_SCAN,
        signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      })
      return { connectionId, ...recipientsOf(result) }
    },
  }
}
