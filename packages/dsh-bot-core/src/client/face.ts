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

/** What can be done to a pending bot; a refusal lands in `status`, on its row. */
export interface PendingActions {
  retryCreate(id: string): void
  discardCreate(id: string): void
  retryRemove(id: string): void
  dismissRemove(id: string): void
}

/** A settable observable value shared between the sidebar and the frame-wide overlay. */
export type Settable<T> = Observable<T> & { set(value: T): void }

/** What the Bots section's `sidebar.session.action` registration injects. */
export interface BotsFace {
  readonly bots: Observable<BotsState>
  /** How bot-core's single-Slot registrations stand, shown when refused. */
  readonly registrations: Registrations
  readonly status: Observable<Readonly<Record<string, BotStatus>>>
  /** Connector actions waiting for the owner's decision, per bot that has any. */
  readonly waiting: Observable<Readonly<Record<string, number>>>
  /** Unacknowledged credential incidents, per bot that has any. */
  readonly incidents: Observable<Readonly<Record<string, number>>>
  readonly sessions: Observable<SessionListState>
  readonly workspaces: Observable<WorkspaceSnapshot>
  openSession(sessionId: string): void
  /** Say why an archived session does not open, as Workspaces does. */
  notifyArchivedNotOpenable(): void
  newSession(bot: BotView): void
  /** Resolves once the Host accepted the bot (its creation goes on in the background); rejects with its refusal. */
  /** The browser adds its language (its `format.locale`). */
  createBot(input: Omit<BotCreateInput, "language">): Promise<void>
  readonly pending: PendingActions
  /** The bot whose creation progress the main view shows, if any. */
  readonly progress: Observable<string | null>
  openProgress(botId: string): void
  clearError(id: string): void
  /**
   * Open the bot's settings screen at `section` (the first one when omitted).
   * @throws when `section` is not a registered settings section.
   */
  openSettings(botId: string, section?: string): void
  /** Ask the user to confirm deleting the bot (typing its name). */
  confirmDelete(botId: string): void
  /** Open the dsh-bots settings screen, shared by every bot. */
  openGlobalSettings(): void
  /** A section of the dsh-bots settings that calls for the user; the ⚙ is marked meanwhile. */
  readonly globalSettingsAttention: Observable<SettingsBadge | null>
  /** Whether the New bot dialog is open; shared with the frame-wide overlay. */
  readonly createDialog: Settable<boolean>
  readonly expansion: ExpansionStore
  /** Pin a bot open or closed; closing folds its sessions back to the base window. */
  setExpanded(botId: string, open: boolean): void
  /** Which bots list their archived sessions. */
  readonly archivedView: ArchivedViewStore
  /** Start a new Main for the bot now (the owner's own rotation); the outcome shows as a notice or on its row. */
  startNewMain(bot: BotView): void
  /** List or hide a bot's archived sessions; listing them also opens the bot. */
  setArchivedShown(botId: string, shown: boolean): void
  /** Each bot's window over its sessions ("Show more"). */
  readonly windows: SessionWindows
  readonly archive: Pick<SessionArchive, "archive" | "unarchive">
  /** The sessions bots' Main sessions manage, and handing them over or back. */
  readonly managed: ManagedSessionsStore
  /** Id of the bot whose menu is open. */
  readonly menuBot: Observable<string | undefined>
  /** Opener id the open bot menu was opened with; undefined when closed or opened by a gesture. */
  readonly menuOpener: Observable<string | undefined>
  /** Open the bot's shared menu; activating the opener of the open menu again closes it. */
  openBotMenu(bot: BotView, point: MenuPoint, opener: string | undefined): void
  /** Id of the bot session whose menu is open. */
  readonly menuSession: Observable<string | undefined>
  openSessionMenu(session: BotSessionRef, point: MenuPoint): void
}

export interface ActionProps extends BotsFace {
  readonly wide: boolean
  readonly t: Translate
}
