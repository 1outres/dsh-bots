import type { ComponentType } from "react"
import type { BotView } from "../shared/bots"
import type { ActionsHub } from "./approvals/hub"
import { pendingCount } from "./approvals/view"
import type { ConnectorsHub } from "./connectors-hub"
import { IconActions, IconFolder, IconNotes, IconSessionLog } from "./icons"
import { createStore, derive, type Observable } from "./observable"
import type { InquiriesHub } from "./senders/inquiries"
import {
  ACTIONS_PANEL,
  NOTES_PANEL,
  SESSION_LOG_PANEL,
  type SidePanels,
  samePanel,
} from "./shell/side-panels"
import type { Translate } from "./types"
import type { Viewer } from "./viewer"

export interface ShellMenuContext {
  readonly bot: BotView
  readonly sessionId: string
}

export interface ShellMenuEntry {
  readonly id: string
  readonly order: number
  label(t: Translate, bot: BotView): string
  readonly icon: ComponentType<{ size?: number }>
  shown?(context: ShellMenuContext): boolean
  pressed?(context: ShellMenuContext): Observable<boolean>
  disabled?(context: ShellMenuContext): Observable<boolean>
  attention?(context: ShellMenuContext): Observable<boolean>
  count?(context: ShellMenuContext): Observable<number>
  run(context: ShellMenuContext, anchor: HTMLElement): void
}

export interface ShellMenu extends Observable<readonly ShellMenuEntry[]> {
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

export const FILES_ENTRY_ID = "bot-core.files"

export const NOTES_ENTRY_ID = "bot-core.notes"

export const ACTIONS_ENTRY_ID = "bot-core.actions"

export const SESSION_LOG_ENTRY_ID = "bot-core.session-log"

export const entryShown = (entry: ShellMenuEntry, context: ShellMenuContext): boolean =>
  entry.shown?.(context) ?? true

export interface BuiltinEntrySources {
  readonly viewer: Pick<Viewer, "toggle" | "of" | "getSnapshot" | "subscribe">
  readonly panels: Pick<SidePanels, "toggle" | "getSnapshot" | "subscribe">
  readonly approvals: ActionsHub
  readonly inquiries: InquiriesHub
  readonly connectors: ConnectorsHub
}

export function builtinShellEntries(sources: BuiltinEntrySources): ShellMenuEntry[] {
  const { viewer, panels, approvals, inquiries, connectors } = sources
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
        derive(
          [approvals.feed(bot.id), inquiries.feed(bot.id)],
          (state, asked) =>
            (state.status === "ready" ? pendingCount(state.actions) : 0) +
            (asked.status === "ready"
              ? asked.inquiries.filter((inquiry) => inquiry.status.state === "pending").length
              : 0),
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
