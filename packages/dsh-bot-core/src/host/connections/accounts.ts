import { connectionName } from "../../shared/connections"
import type { BotConnectorAccount, ConnectorJson } from "../../shared/connectors"
import type { CatalogConnector } from "../connectors/catalog"
import type { ConnectionRecord } from "./domain"
import type { ConnectionStore } from "./store"

export type AccountResolution =
  | { readonly ok: true; readonly connection: ConnectionRecord }
  | { readonly ok: false; readonly reason: string }

/** The accounts a bot's connector acts as: its assigned connections of the connector's provider. */
export interface ConnectorAccounts {
  /** The bot's accounts of the connector's provider, as people see them. */
  of(botId: string, connector: CatalogConnector): readonly BotConnectorAccount[]
  /** Those a call may act as now: active, and granted the connector's scopes. */
  usable(botId: string, connector: CatalogConnector): readonly ConnectionRecord[]
  /** The account a call names (its email or label). */
  resolve(botId: string, connector: CatalogConnector, account: string): AccountResolution
  /** The account an approved action was made as, if the bot may still act as it. */
  pinned(botId: string, connector: CatalogConnector, connectionId: string): AccountResolution
  /** Why the connector cannot serve the bot for lack of an account, or undefined. */
  problem(botId: string, connector: CatalogConnector): string | undefined
  /** The `<connector>_accounts` tool's answer. */
  list(
    botId: string,
    connector: CatalogConnector,
  ): { readonly text: string; readonly data: ConnectorJson }
}

const grants = (record: ConnectionRecord, connector: CatalogConnector) =>
  record.services.includes(connector.id)

export function createConnectorAccounts(
  store: Pick<ConnectionStore, "assigned" | "get" | "isAssigned">,
): ConnectorAccounts {
  const assigned = (botId: string, connector: CatalogConnector) => {
    const provider = connector.connections?.provider
    return provider === undefined
      ? []
      : store.assigned(botId).filter((record) => record.provider === provider)
  }
  const check = (record: ConnectionRecord, connector: CatalogConnector): AccountResolution => {
    const name = connectionName(record)
    if (record.status !== "active") {
      return {
        ok: false,
        reason: `the account ${name} must be signed in again by the user in the bot's Connectors settings (${record.status})`,
      }
    }
    if (!grants(record, connector)) {
      return {
        ok: false,
        reason: `the account ${name} has not granted ${connector.name} access; the user must sign it in again with ${connector.name} selected`,
      }
    }
    return { ok: true, connection: record }
  }
  const names = (botId: string, connector: CatalogConnector) =>
    assigned(botId, connector)
      .map((record) => connectionName(record))
      .join(", ")

  return {
    of: (botId, connector) =>
      assigned(botId, connector).map((record) => ({
        connectionId: record.id,
        label: record.label,
        ...(record.account.email === undefined ? {} : { email: record.account.email }),
        status: record.status,
        granted: grants(record, connector),
      })),
    usable: (botId, connector) =>
      assigned(botId, connector).filter((record) => check(record, connector).ok),
    resolve(botId, connector, account) {
      const wanted = account.trim().toLowerCase()
      const mine = assigned(botId, connector)
      if (mine.length === 0) {
        return {
          ok: false,
          reason: `this bot has no ${connector.name} account; the user connects one in the bot's Connectors settings`,
        }
      }
      const byEmail = mine.filter((record) => record.account.email?.toLowerCase() === wanted)
      const matches =
        byEmail.length > 0
          ? byEmail
          : mine.filter((record) => record.label.toLowerCase() === wanted)
      const [match] = matches
      if (match === undefined) {
        return {
          ok: false,
          reason: `no account "${account}" of this bot; its accounts: ${names(botId, connector)}`,
        }
      }
      if (matches.length > 1) {
        return {
          ok: false,
          reason: `"${account}" names several accounts; use the email: ${names(botId, connector)}`,
        }
      }
      return check(match, connector)
    },
    pinned(botId, connector, connectionId) {
      const record = store.get(connectionId)
      if (record === undefined || !store.isAssigned(botId, connectionId)) {
        return { ok: false, reason: "the account it was made as is no longer assigned to this bot" }
      }
      return check(record, connector)
    },
    problem(botId, connector) {
      if (connector.connections === undefined) return undefined
      const mine = assigned(botId, connector)
      if (mine.length === 0) return "connect an account in the bot's Connectors settings"
      if (mine.every((record) => !check(record, connector).ok)) {
        return "every account of this bot must be signed in again (or grant this connector's access)"
      }
      return undefined
    },
    list(botId, connector) {
      const rows = assigned(botId, connector).map((record) => {
        const verdict = check(record, connector)
        return {
          account: record.account.email ?? record.label,
          label: record.label,
          usable: verdict.ok,
          ...(verdict.ok ? {} : { problem: verdict.reason }),
        }
      })
      const text =
        rows.length === 0
          ? `This bot has no ${connector.name} account. Ask the user to connect one in the bot's Connectors settings.`
          : [
              `${connector.name} accounts of this bot (pass one as "account"):`,
              ...rows.map(
                (row) =>
                  `- ${row.account}${row.label === row.account ? "" : ` ("${row.label}")`}${row.usable ? "" : ` — not usable: ${row.problem}`}`,
              ),
            ].join("\n")
      return { text, data: { accounts: rows } }
    },
  }
}
