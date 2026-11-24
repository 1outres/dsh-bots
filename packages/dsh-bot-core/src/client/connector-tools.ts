import type {
  BotConnectorView,
  ConnectorAccountPermission,
  ConnectorPermission,
  ConnectorPermissionChange,
  ConnectorToolDescriptor,
} from "../shared/connectors"

/** One tool of a connector with the bot's permission of it. */
export interface ConnectorToolRow {
  readonly connectorId: string
  readonly tool: ConnectorToolDescriptor
  readonly default: ConnectorPermission
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
  /** Each of the bot's accounts, for a connector with connections. */
  readonly accounts: readonly ConnectorAccountRow[]
}

/** A tool's permission as one account. */
export interface ConnectorAccountRow extends ConnectorAccountPermission {
  readonly name: string
}

/** Tool lists from this long get a filter. */
export const TOOLS_FILTER_FROM = 10

/**
 * The connector's tools in its order, each with its permission.
 * @throws when the view lacks a tool's permission (the Host lists every registered tool's).
 */
export function toolRows(view: BotConnectorView): readonly ConnectorToolRow[] {
  const permissions = new Map(view.permissions.map((entry) => [entry.tool, entry]))
  return view.connector.tools.map((tool) => {
    const entry = permissions.get(tool.name)
    if (entry === undefined) {
      throw new Error(
        `bot-core: connector "${view.connector.id}" lists no permission of "${tool.name}"`,
      )
    }
    const names = new Map(
      (view.accounts ?? []).map((account) => [
        account.connectionId,
        account.email ?? account.label,
      ]),
    )
    return {
      connectorId: view.connector.id,
      tool,
      default: entry.default,
      ...(entry.override === undefined ? {} : { override: entry.override }),
      effective: entry.effective,
      accounts: (entry.accounts ?? []).map((account) => ({
        ...account,
        name: names.get(account.connectionId) ?? account.connectionId,
      })),
    }
  })
}

const wordsOf = (query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)

/**
 * Rows matching every word of the query: those whose name in the connector has them first,
 * then those whose description has them, each in the connector's order.
 */
export function filterTools(
  rows: readonly ConnectorToolRow[],
  query: string,
): readonly ConnectorToolRow[] {
  const words = wordsOf(query)
  if (words.length === 0) return rows
  const has = (text: string) => words.every((word) => text.toLowerCase().includes(word))
  const byName = rows.filter((row) => has(row.tool.name))
  const byDescription = rows.filter((row) => !byName.includes(row) && has(row.tool.description))
  return [...byName, ...byDescription]
}

/** How many tools the bot's permission differs from the default of. */
export const overriddenCount = (rows: readonly ConnectorToolRow[]): number =>
  rows.filter((row) => row.override !== undefined).length

/**
 * The change that gives a tool `next`: picking the tool's default drops the
 * override, so the tool follows its connector's default; undefined when
 * nothing would change.
 */
export function permissionChange(
  row: ConnectorToolRow,
  next: ConnectorPermission,
): ConnectorPermissionChange | undefined {
  const permission = next === row.default ? null : next
  if (permission === (row.override ?? null)) return undefined
  return { connectorId: row.connectorId, tool: row.tool.name, permission }
}

/** The change that drops a tool's override; undefined when it has none. */
export function resetChange(row: ConnectorToolRow): ConnectorPermissionChange | undefined {
  if (row.override === undefined) return undefined
  return { connectorId: row.connectorId, tool: row.tool.name, permission: null }
}

/** Every override of the rows, dropped. */
export function resetChanges(
  rows: readonly ConnectorToolRow[],
): readonly ConnectorPermissionChange[] {
  return rows.flatMap((row) => {
    const change = resetChange(row)
    return change === undefined ? [] : [change]
  })
}

/**
 * Whether a change lets a tool run without asking against its connector's
 * default (`ask`: it acts outside and may not be undone; `disallow`: kept
 * from the bot), which the user confirms first. Undefined for every other change.
 */
export function looseningOf(
  row: ConnectorToolRow,
  change: ConnectorPermissionChange,
): "ask" | "disallow" | undefined {
  const next = change.permission ?? row.default
  if (next !== "allow" || row.effective === "allow" || row.default === "allow") return undefined
  return row.default
}

/** The change that gives the tool `next` as one account; `null` follows the tool's permission. */
export function accountChange(
  row: ConnectorToolRow,
  account: ConnectorAccountRow,
  next: ConnectorPermission | null,
): ConnectorPermissionChange | undefined {
  if (next === (account.override ?? null)) return undefined
  return {
    connectorId: row.connectorId,
    tool: row.tool.name,
    permission: next,
    connectionId: account.connectionId,
  }
}

/** Whether an account's change lets the tool run without asking against its default. */
export function accountLoosening(
  row: ConnectorToolRow,
  account: ConnectorAccountRow,
  change: ConnectorPermissionChange,
): "ask" | "disallow" | undefined {
  const next = change.permission ?? row.effective
  if (next !== "allow" || account.effective === "allow" || row.default === "allow") return undefined
  return row.default
}

/** A tool whose permission as one account differs from the tool's. */
export interface AccountException {
  readonly row: ConnectorToolRow
  readonly account: ConnectorAccountRow
}

/** The accounts the connector's tools can differ by. */
export const connectorAccounts = (
  rows: readonly ConnectorToolRow[],
): readonly ConnectorAccountRow[] => rows[0]?.accounts ?? []

/** The tool's permission as the account; undefined when the account is not one of the tool's. */
export const accountOf = (
  row: ConnectorToolRow,
  connectionId: string,
): ConnectorAccountRow | undefined =>
  row.accounts.find((account) => account.connectionId === connectionId)

/** Every account's exceptions, account by account, each in the connector's order of tools. */
export function accountExceptions(rows: readonly ConnectorToolRow[]): readonly AccountException[] {
  return connectorAccounts(rows).flatMap(({ connectionId }) =>
    rows.flatMap((row) => {
      const account = accountOf(row, connectionId)
      return account?.override === undefined ? [] : [{ row, account }]
    }),
  )
}

/** The tools the account follows the tool's permission of, which can get an exception. */
export const exceptionCandidates = (
  rows: readonly ConnectorToolRow[],
  connectionId: string,
): readonly ConnectorToolRow[] =>
  rows.filter((row) => {
    const account = accountOf(row, connectionId)
    return account !== undefined && account.override === undefined
  })
