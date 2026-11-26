import type {
  BotConnectorView,
  ConnectorAccountPermission,
  ConnectorPermission,
  ConnectorPermissionChange,
  ConnectorToolDescriptor,
} from "../shared/connectors"

export interface ConnectorToolRow {
  readonly connectorId: string
  readonly tool: ConnectorToolDescriptor
  readonly default: ConnectorPermission
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
  readonly accounts: readonly ConnectorAccountRow[]
}

export interface ConnectorAccountRow extends ConnectorAccountPermission {
  readonly name: string
}

export const TOOLS_FILTER_FROM = 10

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

export const overriddenCount = (rows: readonly ConnectorToolRow[]): number =>
  rows.filter((row) => row.override !== undefined).length

export function permissionChange(
  row: ConnectorToolRow,
  next: ConnectorPermission,
): ConnectorPermissionChange | undefined {
  const permission = next === row.default ? null : next
  if (permission === (row.override ?? null)) return undefined
  return { connectorId: row.connectorId, tool: row.tool.name, permission }
}

export function resetChange(row: ConnectorToolRow): ConnectorPermissionChange | undefined {
  if (row.override === undefined) return undefined
  return { connectorId: row.connectorId, tool: row.tool.name, permission: null }
}

export function resetChanges(
  rows: readonly ConnectorToolRow[],
): readonly ConnectorPermissionChange[] {
  return rows.flatMap((row) => {
    const change = resetChange(row)
    return change === undefined ? [] : [change]
  })
}

export function looseningOf(
  row: ConnectorToolRow,
  change: ConnectorPermissionChange,
): "ask" | "disallow" | undefined {
  const next = change.permission ?? row.default
  if (next !== "allow" || row.effective === "allow" || row.default === "allow") return undefined
  return row.default
}

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

export function accountLoosening(
  row: ConnectorToolRow,
  account: ConnectorAccountRow,
  change: ConnectorPermissionChange,
): "ask" | "disallow" | undefined {
  const next = change.permission ?? row.effective
  if (next !== "allow" || account.effective === "allow" || row.default === "allow") return undefined
  return row.default
}

export interface AccountException {
  readonly row: ConnectorToolRow
  readonly account: ConnectorAccountRow
}

export const connectorAccounts = (
  rows: readonly ConnectorToolRow[],
): readonly ConnectorAccountRow[] => rows[0]?.accounts ?? []

export const accountOf = (
  row: ConnectorToolRow,
  connectionId: string,
): ConnectorAccountRow | undefined =>
  row.accounts.find((account) => account.connectionId === connectionId)

export function accountExceptions(rows: readonly ConnectorToolRow[]): readonly AccountException[] {
  return connectorAccounts(rows).flatMap(({ connectionId }) =>
    rows.flatMap((row) => {
      const account = accountOf(row, connectionId)
      return account?.override === undefined ? [] : [{ row, account }]
    }),
  )
}

export const exceptionCandidates = (
  rows: readonly ConnectorToolRow[],
  connectionId: string,
): readonly ConnectorToolRow[] =>
  rows.filter((row) => {
    const account = accountOf(row, connectionId)
    return account !== undefined && account.override === undefined
  })
