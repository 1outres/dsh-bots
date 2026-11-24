import type { SessionListState, WorkspaceSnapshot } from "./dsh/context"
import { type BotsState, botSessionIds, snapshotOf } from "./session-classification"

/** What the stock session lists show, to tell whether Ungrouped keeps a row. */
export interface SessionViews {
  readonly list: SessionListState
  readonly workspaces: WorkspaceSnapshot
}

const SCROLLPORT = "[data-sidebar-scrollport]"
/** DSH's Ungrouped bucket: its heading row and its "show more" button (group key ""). */
const UNGROUPED_ROWS = ['[data-row-key="workspace:"]', '[data-row-key="overflow:"]']

/**
 * Whether the Workspace browser lists a session under Ungrouped that is not
 * a bot's, judged as DSH's default view groups (dsh-client-ui-workspace
 * `groupByWorkspace` / `sessionVisible`, archived filter `default`).
 */
export function hasOtherUngrouped(views: SessionViews, hidden: ReadonlySet<string>): boolean {
  const accounted = new Set(views.workspaces.items.flatMap((workspace) => workspace.sessionIds))
  const archived = new Set(views.workspaces.archivedSessionIds)
  return views.list.ids.some((id) => {
    if (hidden.has(id) || accounted.has(id) || archived.has(id)) return false
    const session = views.list.byId[id]
    if (session === undefined || session.origin === "subagent") return false
    return !session.blank || (session.retainedBy?.mainView ?? 0) > 0
  })
}

function hidingCss(sessions: ReadonlySet<string>, views: SessionViews): string {
  if (sessions.size === 0) return ""
  const quote = (value: string) => JSON.stringify(value)
  const rules = [...sessions]
    .sort()
    .map(
      (id) =>
        `${SCROLLPORT} [data-row-key=${quote(`session:${id}`)}] { display: none !important; }`,
    )
  if (!hasOtherUngrouped(views, sessions)) {
    rules.push(
      `${UNGROUPED_ROWS.map((row) => `${SCROLLPORT} ${row}`).join(", ")} { display: none !important; }`,
    )
  }
  return rules.join("\n")
}

/**
 * CSS that hides the bots' sessions (and those of bots being created) from
 * the stock session lists, keyed on the Workspace browser's stable row
 * markers; the Ungrouped heading goes too when only bot sessions are
 * ungrouped. Nothing is hidden while no bots list is held.
 */
export function botSessionsCss(state: BotsState, views: SessionViews): string {
  const snapshot = snapshotOf(state)
  return snapshot === undefined ? "" : hidingCss(botSessionIds(snapshot), views)
}
