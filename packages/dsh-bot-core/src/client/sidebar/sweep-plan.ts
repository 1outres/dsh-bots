import type { SidebarSurface } from "../dsh/sidebar-right"
import type { MessageKey } from "../i18n"
import { BOT_FILE_TAB_KIND } from "./file-tab"

/** DSH's tab kinds the sweep treats specially (ui-sidebar-right seed.ts, ui-sidebar-files, ui-sidebar-browser, ui-plan). */
export const GUIDE_KIND = "guide"
export const FILES_KIND = "files"
export const BROWSER_KIND = "browser"
export const PLAN_KIND = "plan"

export type SweepAction =
  | { readonly kind: "file"; readonly tabId: string }
  | { readonly kind: "browse" }
  | { readonly kind: "toggle" }
  | { readonly kind: "external"; readonly tabId: string }
  | { readonly kind: "document"; readonly tabId: string }
  | { readonly kind: "refused"; readonly tabId: string; readonly tabKind: string }

export interface SweepPlan {
  /** In tab order; routed before anything closes, since closing ends a tab's navigation record. */
  readonly actions: readonly SweepAction[]
  /** Every tab but the guide, which DSH never closes while it stands alone. */
  readonly close: readonly string[]
  readonly collapse: boolean
}

/** What a sweep remembers between two layouts of one session. */
export interface SweepMemory {
  readonly seen: ReadonlySet<string>
  /** Tabs of the layout restored when the seat mounted: closed, never opened. */
  readonly restored: ReadonlySet<string>
  /** Whether the last layout was expanded: a toggle is a change to expanded. */
  readonly expanded: boolean
}

export function initialSweepMemory(surface: SidebarSurface | undefined): SweepMemory {
  const restored = new Set(Object.keys(surface?.layout.tabs ?? {}))
  return { seen: new Set(), restored, expanded: surface?.layout.expanded ?? false }
}

function actionOf(tab: { readonly id: string; readonly kind: string }): SweepAction | undefined {
  switch (tab.kind) {
    case GUIDE_KIND:
      return undefined
    case BOT_FILE_TAB_KIND:
      return { kind: "file", tabId: tab.id }
    case FILES_KIND:
      return { kind: "browse" }
    case BROWSER_KIND:
      return { kind: "external", tabId: tab.id }
    case PLAN_KIND:
      return { kind: "document", tabId: tab.id }
    default:
      return { kind: "refused", tabId: tab.id, tabKind: tab.kind }
  }
}

/**
 * What to do with a bot session's DSH layout after a change. A tab not seen
 * before is routed unless the layout restored at mount held it; an expansion
 * that brought nothing but the default page is the toggle, and a layout that
 * stays expanded toggles nothing, so nothing flaps.
 */
export function planSweep(
  surface: SidebarSurface | undefined,
  memory: SweepMemory,
): { readonly plan: SweepPlan; readonly memory: SweepMemory } {
  if (surface === undefined) return { plan: { actions: [], close: [], collapse: false }, memory }
  const tabs = Object.values(surface.layout.tabs)
  const actions = tabs
    .filter((tab) => !memory.seen.has(tab.id) && !memory.restored.has(tab.id))
    .map(actionOf)
    .filter((action) => action !== undefined)
  const { expanded } = surface.layout
  if (expanded && !memory.expanded && actions.length === 0) actions.push({ kind: "toggle" })
  return {
    plan: {
      actions,
      close: tabs.filter((tab) => tab.kind !== GUIDE_KIND).map((tab) => tab.id),
      collapse: expanded,
    },
    memory: { seen: new Set(tabs.map((tab) => tab.id)), restored: memory.restored, expanded },
  }
}

const REFUSAL_KEYS: Readonly<Record<string, MessageKey>> = {
  terminal: "notice.refused.terminal",
  [BROWSER_KIND]: "notice.refused.browser",
  [PLAN_KIND]: "notice.refused.plan",
  [BOT_FILE_TAB_KIND]: "notice.refused.file",
  subagentchat: "notice.refused.subagent",
  scheduleTask: "notice.refused.schedule",
}

/** The notice for a tab of `kind` refused in a bot session; uncommon kinds share the generic one. */
export function refusalKey(kind: string): MessageKey {
  return REFUSAL_KEYS[kind] ?? "notice.refused"
}
