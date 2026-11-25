import type { ActionsHub } from "../approvals/hub"
import type { RenderShellSlot } from "../connector-panels/ConnectorPanel"
import type { ConnectorPanelsFace } from "../connector-panels/face"
import type { MainConversationSlotProps } from "../dsh/conversation"
import type { PendingActions } from "../face"
import type { FilesFace } from "../files/files-face"
import type { PanelWidth } from "../files/panel-width"
import type { NotesFace } from "../notes/face"
import type { Observable } from "../observable"
import type { BotsState, RegistrationStatus, SessionClass } from "../session-classification"
import type { ShellMenu } from "../shell-menu"
import type { BotStatus } from "../status"
import type { NoticeDismissal } from "./notice-dismissal"
import type { SidePanels } from "./side-panels"

/** What bot-core injects into its `main.conversation` entry. */
export interface ShellFace {
  /** The class of the session the main view shows (the one the entry's session scope binds). */
  readonly classification: Observable<SessionClass>
  readonly bots: Observable<BotsState>
  /** bot-core's `rightbar.session` lockdown registration. */
  readonly rightbarRegistration: Observable<RegistrationStatus>
  /** The refused lockdown's notice, dismissed once for every bot session of the page. */
  readonly lockdownNotice: NoticeDismissal
  readonly menu: ShellMenu
  /** Open the bot's settings screen (at a section), from the header's settings button or a connector's panel. */
  openSettings(botId: string, section?: string): void
  /** Each bot's last failure, shared with the Bots tree. */
  readonly status: Observable<Readonly<Record<string, BotStatus>>>
  clearError(botId: string): void
  readonly files: FilesFace
  /** The bot's notes, read in a side panel. */
  readonly notes: NotesFace
  /** The bot whose creation progress the main view shows, if any. */
  readonly progress: Observable<string | null>
  readonly pending: PendingActions
  /** Each bot's connector actions, in the Actions panel. */
  readonly approvals: ActionsHub
  readonly actionsWidth: PanelWidth
  /** The Actions or connector panel each session shows. */
  readonly panels: SidePanels
  /** Connectors' panels beside the chat. */
  readonly connectorPanels: ConnectorPanelsFace
  /** Unacknowledged credential incidents per bot (docs/specs/bot-vaults.md §7.3). */
  readonly incidents: Observable<Readonly<Record<string, number>>>
}

export interface ShellSlotProps extends MainConversationSlotProps, ShellFace {
  /** The child Slots the shell's registration declares. */
  readonly renderSlot: RenderShellSlot
}
