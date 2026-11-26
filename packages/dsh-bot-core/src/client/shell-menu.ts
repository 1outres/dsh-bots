import type { ComponentType } from "react"
import type { BotView } from "../shared/bots"
import type { ActionsHub } from "./approvals/hub"
import { pendingCount } from "./approvals/view"
import type { ConnectorsHub } from "./connectors-hub"
import { IconActions, IconFolder, IconNotes, IconSessionLog } from "./icons"
import { createStore, derive, type Observable } from "./observable"
import {
  ACTIONS_PANEL,
  NOTES_PANEL,
  SESSION_LOG_PANEL,
  type SidePanels,
  samePanel,
} from "./shell/side-panels"
import type { Translate } from "./types"
import type { Viewer } from "./viewer"

/** The bot session a menu bar entry acts on. */
export interface ShellMenuContext {
  readonly bot: BotView
  readonly sessionId: string
}

/** One button of the bot session shell's menu bar, in `order` (ascending, then id). */
export interface ShellMenuEntry {
  readonly id: string
  readonly order: number
  /** Accessible name and tooltip. */
  label(t: Translate, bot: BotView): string
  readonly icon: ComponentType<{ size?: number }>
  /** Whether the session has the entry; absent for every bot session. */
  shown?(context: ShellMenuContext): boolean
  /** A toggle's state (`aria-pressed`); absent for a plain button. */
  pressed?(context: ShellMenuContext): Observable<boolean>
  /** Absent for an entry that can always act. */
  disabled?(context: ShellMenuContext): Observable<boolean>
  /** Whether something waits for the person there (a dot on the button); absent for never. */
  attention?(context: ShellMenuContext): Observable<boolean>
  /** How many things wait for the person there (a count badge, over the dot); absent for none. */
  count?(context: ShellMenuContext): Observable<number>
  /** @param anchor - the entry's button, e.g. to place a popover. */
  run(context: ShellMenuContext, anchor: HTMLElement): void
}

export interface ShellMenu extends Observable<readonly ShellMenuEntry[]> {
  /** @returns the disposer; a second entry with the same id is refused. */
  register(entry: ShellMenuEntry): () => void
}

export const byOrder = (a: ShellMenuEntry, b: ShellMenuEntry) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function createShellMenu(): ShellMenu {
  const entries = createStore<readonly ShellMenuEntry[]>([])
  return {
    getSnapshot: entries.getSnapshot,
    subscribe: entries.subscribe,
    register(entry) {
      if (entries.getSnapshot().some((item) => item.id === entry.id)) {
        throw new Error(`bot-core: shell menu entry "${entry.id}" is already registered`)
      }
      entries.update((current) => [...current, entry].sort(byOrder))
      return () => {
        if (entries.getSnapshot().includes(entry)) {
          entries.update((current) => current.filter((item) => item !== entry))
        }
      }
    },
  }
}

/** The built-in Files entry, which the file panel hands focus back to as it closes. */
export const FILES_ENTRY_ID = "bot-core.files"

/** The built-in Notes entry, which the notes panel hands focus back to as it closes. */
export const NOTES_ENTRY_ID = "bot-core.notes"

/** The built-in Actions entry, which the Actions panel hands focus back to as it closes. */
export const ACTIONS_ENTRY_ID = "bot-core.actions"

/** The built-in Session log entry (the Main only), which its panel hands focus back to as it closes. */
export const SESSION_LOG_ENTRY_ID = "bot-core.session-log"

/** Whether a menu entry belongs on the session's menu bar. */
export const entryShown = (entry: ShellMenuEntry, context: ShellMenuContext): boolean =>
  entry.shown?.(context) ?? true

export interface BuiltinEntrySources {
  readonly viewer: Pick<Viewer, "toggle" | "of" | "getSnapshot" | "subscribe">
  readonly panels: Pick<SidePanels, "toggle" | "getSnapshot" | "subscribe">
  readonly approvals: ActionsHub
  readonly connectors: ConnectorsHub
}

/**
 * bot-core's own entries: the bot's files, its notes, its connector actions (a count
 * of those waiting for a decision, a dot while a connector requests a
 * person), and on the Main its session log. Its settings open from the header
 * and new sessions start from the bot's row in the sidebar.
 */
export function builtinShellEntries(sources: BuiltinEntrySources): ShellMenuEntry[] {
  const { viewer, panels, approvals, connectors } = sources
  return [
    {
      id: FILES_ENTRY_ID,
      order: 150,
      label: (t, bot) => t("shell.files", { name: bot.name }),
      icon: IconFolder,
      pressed: ({ sessionId }) => derive([viewer], () => viewer.of(sessionId).open),
      run: ({ sessionId }) => viewer.toggle(sessionId),
    },
    {
      id: NOTES_ENTRY_ID,
      order: 155,
      label: (t, bot) => t("shell.notes", { name: bot.name }),
      icon: IconNotes,
      pressed: ({ sessionId }) =>
        derive([panels], (open) => samePanel(open[sessionId], NOTES_PANEL)),
      run: ({ sessionId }) => panels.toggle(sessionId, NOTES_PANEL),
    },
    {
      id: ACTIONS_ENTRY_ID,
      order: 160,
      label: (t, bot) => t("shell.actions", { name: bot.name }),
      icon: IconActions,
      pressed: ({ sessionId }) =>
        derive([panels], (open) => samePanel(open[sessionId], ACTIONS_PANEL)),
      count: ({ bot }) =>
        derive([approvals.feed(bot.id)], (state) =>
          state.status === "ready" ? pendingCount(state.actions) : 0,
        ),
      attention: ({ bot }) =>
        derive(
          [connectors.feed(bot.id)],
          (state) =>
            state.status === "ready" &&
            state.snapshot.connectors.some(
              (view) => view.connector.panel !== undefined && view.status.request !== undefined,
            ),
        ),
      run: ({ sessionId }) => panels.toggle(sessionId, ACTIONS_PANEL),
    },
    {
      id: SESSION_LOG_ENTRY_ID,
      order: 165,
      label: (t, bot) => t("shell.sessionLog", { name: bot.name }),
      icon: IconSessionLog,
      shown: ({ bot, sessionId }) => bot.mainSessionId === sessionId,
      pressed: ({ sessionId }) =>
        derive([panels], (open) => samePanel(open[sessionId], SESSION_LOG_PANEL)),
      run: ({ sessionId }) => panels.toggle(sessionId, SESSION_LOG_PANEL),
    },
  ]
}
