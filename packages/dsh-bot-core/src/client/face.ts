import type { BotCreateInput, BotView } from "../shared/bots"
import type { ArchivedViewStore } from "./archived-view"
import type { ExpansionStore } from "./expansion"
import type { ManagedSessionsStore } from "./managed-sessions"
import type { MenuPoint } from "./menu"
import type { BotSessionRef, SessionArchive } from "./session-archive"
import type { BotsState } from "./session-classification"
import type { SessionWindows } from "./session-window"
import type { SettingsBadge } from "./settings-frame/sections"
import type { Registrations } from "./slot-registration"
import type { BotStatus } from "./status"
import type { Observable, SessionListState, Translate, WorkspaceSnapshot } from "./types"

export interface PendingActions {
  retryCreate(id: string): void
  discardCreate(id: string): void
  retryRemove(id: string): void
  dismissRemove(id: string): void
}

export type Settable<T> = Observable<T> & { set(value: T): void }

export interface BotsFace {
  readonly bots: Observable<BotsState>
  readonly registrations: Registrations
  readonly status: Observable<Readonly<Record<string, BotStatus>>>
  readonly waiting: Observable<Readonly<Record<string, number>>>
  readonly incidents: Observable<Readonly<Record<string, number>>>
  readonly sessions: Observable<SessionListState>
  readonly workspaces: Observable<WorkspaceSnapshot>
  openSession(sessionId: string): void
  notifyArchivedNotOpenable(): void
  newSession(bot: BotView): void
  createBot(input: Omit<BotCreateInput, "language">): Promise<void>
  readonly pending: PendingActions
  readonly progress: Observable<string | null>
  openProgress(botId: string): void
  clearError(id: string): void
  openSettings(botId: string, section?: string): void
  confirmDelete(botId: string): void
  openGlobalSettings(): void
  readonly globalSettingsAttention: Observable<SettingsBadge | null>
  readonly createDialog: Settable<boolean>
  readonly expansion: ExpansionStore
  setExpanded(botId: string, open: boolean): void
  readonly archivedView: ArchivedViewStore
  startNewMain(bot: BotView): void
  setArchivedShown(botId: string, shown: boolean): void
  readonly windows: SessionWindows
  readonly archive: Pick<SessionArchive, "archive" | "unarchive">
  readonly managed: ManagedSessionsStore
  readonly menuBot: Observable<string | undefined>
  readonly menuOpener: Observable<string | undefined>
  openBotMenu(bot: BotView, point: MenuPoint, opener: string | undefined): void
  readonly menuSession: Observable<string | undefined>
  openSessionMenu(session: BotSessionRef, point: MenuPoint): void
}

export interface ActionProps extends BotsFace {
  readonly wide: boolean
  readonly t: Translate
}
