import type { BotView, PendingBotView } from "../shared/bots"
import type { BotFlags } from "./bot-flags"
import { type SessionOverflow, type Windows, windowRows } from "./session-window"
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from "./types"

/** Pure derivation and keyboard navigation of the Bots tree (no React, no DOM). */

export const isSelected = (list: SessionListState, id: string | undefined) =>
  id !== undefined && (list.byId[id]?.retainedBy?.mainView ?? 0) > 0

export const botKey = (botId: string) => `bot:${botId}`
export const pendingKey = (botId: string) => `pending:${botId}`
export const sessionKey = (sessionId: string) => `session:${sessionId}`
export const overflowKey = (botId: string) => `overflow:${botId}`

/** One of a bot's sessions besides Main, as its row shows it. */
export interface SessionRow {
  readonly id: string
  readonly archived: boolean
  readonly selected: boolean
  readonly running: boolean
}

/** One bot with the facts its rows render. */
export interface BotNode {
  readonly kind: "bot"
  readonly bot: BotView
  readonly key: string
  readonly expanded: boolean
  /** Listed non-Main sessions, newest first, within the bot's window. */
  readonly sessions: readonly SessionRow[]
  /** The row below them, while the window folds any away. */
  readonly overflow: SessionOverflow | undefined
  /** How many rows the window holds. */
  readonly window: number
  readonly mainSelected: boolean
  readonly childSelected: boolean
  readonly running: boolean
}

/** A bot being created or removed: one row, no sessions. */
export interface PendingNode {
  readonly kind: "pending"
  readonly pending: PendingBotView
  readonly key: string
  /** Its progress is what the main view shows. */
  readonly selected: boolean
}

export type TreeNode = BotNode | PendingNode

/** What activating a treeitem does. */
export type TreeActivation =
  | { readonly kind: "session"; readonly sessionId: string }
  /** An archived session, which cannot be opened (as in Workspaces). */
  | { readonly kind: "archived"; readonly sessionId: string }
  /** The progress of a bot being created. */
  | { readonly kind: "progress"; readonly botId: string }
  /** Show more of the bot's sessions, or fold them back. */
  | {
      readonly kind: "overflow"
      readonly botId: string
      readonly overflow: SessionOverflow
      readonly window: number
    }
  /** Nothing: a bot being removed. */
  | { readonly kind: "none" }

/** One visible treeitem, in document order. */
export interface TreeItem {
  readonly key: string
  readonly level: 1 | 2
  readonly botId: string
  /** What the item does: a bot row opens Main. */
  readonly activates: TreeActivation
  /** Listed bots' rows only: a pending bot has nothing to expand. */
  readonly expanded?: boolean
  /** Rows inside a bot only. */
  readonly parentKey?: string
}

/** How the user arranged the tree: pinned expansions, archived views and windows. */
export interface TreeView {
  readonly expansion: BotFlags
  readonly archivedShown: BotFlags
  readonly windows: Windows
}

/**
 * The bot's sessions besides Main, newest first: subagent sessions are left
 * out, archived ones unless the bot shows them, and a blank (never prompted)
 * session shows only while it is selected.
 */
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

/** What a non-Main session row is called. */
export type SessionLabel =
  | { readonly kind: "titled"; readonly title: string }
  | { readonly kind: "untitled"; readonly ordinal: number }

/**
 * The session's DSH title, or, until DSH's title projection names it, its
 * ordinal among the bot's other sessions in creation order (archived ones
 * counted), which stays the same as sessions are titled, archived or listed
 * newest first.
 */
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

/**
 * Bots newest first. A bot without a saved expansion follows the selection:
 * it is open while one of its non-Main sessions is selected.
 */
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

/**
 * Listed and pending bots in one tree, newest first by creation: a bot being
 * removed keeps its place. `progress` is the bot whose progress the main view
 * shows; while it does, no session row is selected.
 */
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

/** The treeitems inside an expanded bot: Main, its listed sessions, then the overflow row. */
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

/** Visible treeitems in document order: each bot, then its children while expanded. */
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

/** The key of the row showing the main view: the bot row while its sessions are hidden. */
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

/** The single tab stop: the last focused row, else the selected row, else the first row. */
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

/**
 * The tree's response to a key on the focused row, following the WAI-ARIA tree
 * pattern: ↑/↓ move, Home/End jump, → expands a bot or enters its first
 * session, ← collapses a bot or returns to the parent, Enter/Space activate.
 * @returns undefined when the key is not the tree's.
 */
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
