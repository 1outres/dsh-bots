import type { BotView, PendingBotView } from "../shared/bots"
import type { BotFlags } from "./bot-flags"
import { type SessionOverflow, type Windows, windowRows } from "./session-window"
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from "./types"

export const isSelected = (list: SessionListState, id: string | undefined) =>
  id !== undefined && (list.byId[id]?.retainedBy?.mainView ?? 0) > 0

export const botKey = (botId: string) => `bot:${botId}`
export const pendingKey = (botId: string) => `pending:${botId}`
export const sessionKey = (sessionId: string) => `session:${sessionId}`
export const overflowKey = (botId: string) => `overflow:${botId}`

export interface SessionRow {
  readonly id: string
  readonly archived: boolean
  readonly selected: boolean
  readonly running: boolean
}

export interface BotNode {
  readonly kind: "bot"
  readonly bot: BotView
  readonly key: string
  readonly expanded: boolean
  readonly sessions: readonly SessionRow[]
  readonly overflow: SessionOverflow | undefined
  readonly window: number
  readonly mainSelected: boolean
  readonly childSelected: boolean
  readonly running: boolean
}

export interface PendingNode {
  readonly kind: "pending"
  readonly pending: PendingBotView
  readonly key: string
  readonly selected: boolean
}

export type TreeNode = BotNode | PendingNode

export type TreeActivation =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "archived"; readonly sessionId: string }
  | { readonly kind: "progress"; readonly botId: string }
  | {
      readonly kind: "overflow"
      readonly botId: string
      readonly overflow: SessionOverflow
      readonly window: number
    }
  | { readonly kind: "none" }

export interface TreeItem {
  readonly key: string
  readonly level: 1 | 2
  readonly botId: string
  readonly activates: TreeActivation
  readonly expanded?: boolean
  readonly parentKey?: string
}

export interface TreeView {
  readonly expansion: BotFlags
  readonly archivedShown: BotFlags
  readonly windows: Windows
}

export function botSessionRows(
  bot: BotView,
  list: SessionListState,
  snapshot: WorkspaceSnapshot,
  showArchived: boolean,
): SessionRow[] {
  const archived = new Set(snapshot.archivedSessionIds)
  return [...bot.sessionIds].reverse().flatMap((id): SessionRow[] => {
    if (id === bot.mainSessionId) return []
    const row = list.byId[id]
    if (row === undefined || row.origin === "subagent") return []
    const selected = isSelected(list, id)
    if (row.blank && !selected) return []
    const isArchived = archived.has(id)
    if (isArchived && !showArchived) return []
    return [{ id, archived: isArchived, selected, running: !isArchived && row.running }]
  })
}

export type SessionLabel =
  | { readonly kind: "titled"; readonly title: string }
  | { readonly kind: "untitled"; readonly ordinal: number }

export function sessionLabel(
  bot: BotView,
  sessionId: string,
  summary: SessionSummary | undefined,
): SessionLabel {
  const title = summary?.title
  if (title !== undefined && title !== "") return { kind: "titled", title }
  const ordinal = bot.sessionIds.filter((id) => id !== bot.mainSessionId).indexOf(sessionId) + 1
  return { kind: "untitled", ordinal }
}

export function deriveBotNodes(
  bots: readonly BotView[],
  list: SessionListState,
  snapshot: WorkspaceSnapshot,
  view: TreeView,
): BotNode[] {
  return [...bots].reverse().map((bot): BotNode => {
    const rows = botSessionRows(bot, list, snapshot, view.archivedShown[bot.id] ?? false)
    const windowed = windowRows(rows, view.windows[bot.id])
    const childSelected = rows.some((row) => row.selected)
    return {
      kind: "bot",
      bot,
      key: botKey(bot.id),
      expanded: view.expansion[bot.id] ?? childSelected,
      sessions: windowed.rows,
      overflow: windowed.overflow,
      window: windowed.limit,
      mainSelected: isSelected(list, bot.mainSessionId),
      childSelected,
      running: list.byId[bot.mainSessionId]?.running === true || rows.some((row) => row.running),
    }
  })
}

export function deriveTreeNodes(
  bots: readonly BotView[],
  pending: readonly PendingBotView[],
  list: SessionListState,
  snapshot: WorkspaceSnapshot,
  view: TreeView,
  progress: string | null,
): TreeNode[] {
  const showing = progress !== null && pending.some((item) => item.id === progress)
  const nodes: { readonly node: TreeNode; readonly createdAt: number }[] = [
    ...deriveBotNodes(bots, list, snapshot, view).map((node) => ({
      node: showing ? unselected(node) : node,
      createdAt: node.bot.createdAt,
    })),
    ...pending.map((item) => ({
      node: {
        kind: "pending" as const,
        pending: item,
        key: pendingKey(item.id),
        selected: progress === item.id,
      },
      createdAt: item.createdAt,
    })),
  ]
  return nodes
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => right.createdAt - left.createdAt || left.index - right.index)
    .map((entry) => entry.node)
}

function unselected(node: BotNode): BotNode {
  return {
    ...node,
    mainSelected: false,
    childSelected: false,
    sessions: node.sessions.map((row) => (row.selected ? { ...row, selected: false } : row)),
  }
}

function pendingActivation(pending: PendingBotView): TreeActivation {
  return pending.operation.kind === "create"
    ? { kind: "progress", botId: pending.id }
    : { kind: "none" }
}

export function sessionActivation(row: SessionRow): TreeActivation {
  return row.archived
    ? { kind: "archived", sessionId: row.id }
    : { kind: "session", sessionId: row.id }
}

export function botChildren(node: BotNode): TreeItem[] {
  const { bot, key } = node
  const child = (itemKey: string, activates: TreeActivation): TreeItem => ({
    key: itemKey,
    level: 2,
    botId: bot.id,
    activates,
    parentKey: key,
  })
  return [
    child(sessionKey(bot.mainSessionId), { kind: "session", sessionId: bot.mainSessionId }),
    ...node.sessions.map((row) => child(sessionKey(row.id), sessionActivation(row))),
    ...(node.overflow === undefined
      ? []
      : [
          child(overflowKey(bot.id), {
            kind: "overflow",
            botId: bot.id,
            overflow: node.overflow,
            window: node.window,
          }),
        ]),
  ]
}

export function flattenTree(nodes: readonly TreeNode[]): TreeItem[] {
  return nodes.flatMap((node): TreeItem[] => {
    if (node.kind === "pending") {
      return [
        {
          key: node.key,
          level: 1,
          botId: node.pending.id,
          activates: pendingActivation(node.pending),
        },
      ]
    }
    const { bot, key, expanded } = node
    const row: TreeItem = {
      key,
      level: 1,
      botId: bot.id,
      activates: { kind: "session", sessionId: bot.mainSessionId },
      expanded,
    }
    return expanded ? [row, ...botChildren(node)] : [row]
  })
}

export function selectedKey(nodes: readonly TreeNode[]): string | undefined {
  for (const node of nodes) {
    if (node.kind === "pending") {
      if (node.selected) return node.key
      continue
    }
    if (!node.mainSelected && !node.childSelected) continue
    if (!node.expanded) return node.key
    if (node.mainSelected) return sessionKey(node.bot.mainSessionId)
    const row = node.sessions.find((session) => session.selected)
    if (row !== undefined) return sessionKey(row.id)
  }
  return undefined
}

export function rovingKey(
  items: readonly TreeItem[],
  focused: string | undefined,
  selected: string | undefined,
): string | undefined {
  const has = (key: string | undefined) =>
    key !== undefined && items.some((item) => item.key === key)
  if (has(focused)) return focused
  if (has(selected)) return selected
  return items[0]?.key
}

export type TreeAction =
  | { readonly kind: "focus"; readonly key: string }
  | { readonly kind: "expand" | "collapse" | "activate"; readonly item: TreeItem }

export function treeKeyAction(
  items: readonly TreeItem[],
  current: string,
  key: string,
): TreeAction | undefined {
  const index = items.findIndex((item) => item.key === current)
  const item = items[index]
  if (item === undefined) return undefined
  const focus = (target: TreeItem | undefined): TreeAction | undefined =>
    target === undefined || target.key === current ? undefined : { kind: "focus", key: target.key }
  switch (key) {
    case "ArrowDown":
      return focus(items[index + 1])
    case "ArrowUp":
      return focus(items[index - 1])
    case "Home":
      return focus(items[0])
    case "End":
      return focus(items[items.length - 1])
    case "ArrowRight":
      if (item.level === 2 || item.expanded === undefined) return undefined
      if (!item.expanded) return { kind: "expand", item }
      return items[index + 1]?.parentKey === item.key ? focus(items[index + 1]) : undefined
    case "ArrowLeft":
      if (item.level === 1) return item.expanded ? { kind: "collapse", item } : undefined
      return focus(items.find((other) => other.key === item.parentKey))
    case "Enter":
    case " ":
      return { kind: "activate", item }
    default:
      return undefined
  }
}
