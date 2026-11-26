import type { ActionsHub } from "../approvals/hub"
import type { RenderShellSlot } from "../connector-panels/ConnectorPanel"
import type { ConnectorPanelsFace } from "../connector-panels/face"
import type { MainConversationSlotProps } from "../dsh/conversation"
import type { PendingActions } from "../face"
import type { FilesFace } from "../files/files-face"
import type { PanelWidth } from "../files/panel-width"
import type { MainViewFace } from "../main-view/face"
import type { NotesFace } from "../notes/face"
import type { Observable } from "../observable"
import type { BotsState, RegistrationStatus, SessionClass } from "../session-classification"
import type { ShellMenu } from "../shell-menu"
import type { BotStatus } from "../status"
import type { SettingsScreenId } from "../wiring/screens"
import type { NoticeDismissal } from "./notice-dismissal"
import type { ShellPopovers } from "./popovers"
import type { SidePanels } from "./side-panels"

export interface ShellFace {
  readonly classification: Observable<SessionClass>
  readonly bots: Observable<BotsState>
  readonly rightbarRegistration: Observable<RegistrationStatus>
  readonly lockdownNotice: NoticeDismissal
  readonly menu: ShellMenu
  openSettings(botId: string, section?: string): void
  readonly status: Observable<Readonly<Record<string, BotStatus>>>
  clearError(botId: string): void
  readonly files: FilesFace
  readonly notes: NotesFace
  readonly progress: Observable<string | null>
  readonly pending: PendingActions
  readonly approvals: ActionsHub
  readonly actionsWidth: PanelWidth
  readonly panels: SidePanels
  readonly popovers: ShellPopovers
  readonly settingsStack: Observable<readonly SettingsScreenId[]>
  readonly popoverHost: Observable<HTMLElement | null>
  readonly connectorPanels: ConnectorPanelsFace
  readonly mainView: MainViewFace
  readonly incidents: Observable<Readonly<Record<string, number>>>
}

export interface ShellSlotProps extends MainConversationSlotProps, ShellFace {
  readonly renderSlot: RenderShellSlot
}
