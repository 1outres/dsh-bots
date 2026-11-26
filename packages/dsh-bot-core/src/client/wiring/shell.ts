import type { ActionsHub } from "../approvals/hub"
import { CONNECTOR_PANEL_SLOT } from "../connector-panels/ConnectorPanel"
import type { ConnectorPanelsFace } from "../connector-panels/face"
import { SLOT } from "../dsh/slots"
import type { FilesFace } from "../files/files-face"
import { ACTIONS_PANEL_WIDTH, createPanelWidth } from "../files/panel-width"
import type { NotesFace } from "../notes/face"
import { createStore, type Observable } from "../observable"
import type { BotsState, RegistrationStatus } from "../session-classification"
import type { ShellFace } from "../shell/face"
import { createNoticeDismissal } from "../shell/notice-dismissal"
import { createPopoverHost, type PopoverHostFace, PopoverHostView } from "../shell/popover-host"
import type { ShellPopovers } from "../shell/popovers"
import { ShellRoot } from "../shell/ShellRoot"
import type { SidePanels } from "../shell/side-panels"
import { builtinShellEntries, createShellMenu } from "../shell-menu"
import { createSlotRegistration } from "../slot-registration"
import type { ClientContext } from "../types"
import type { BotActions } from "./bots-face"
import type { Classification } from "./classification"
import { overlay } from "./dialogs"
import { NAMESPACE } from "./plugin"

export interface ShellSources {
  readonly classification: Classification
  readonly bots: Observable<BotsState>
  readonly rightbarRegistration: Observable<RegistrationStatus>
  readonly files: FilesFace
  readonly notes: NotesFace
  readonly openSettings: ShellFace["openSettings"]
  readonly actions: Pick<BotActions, "status" | "clearError" | "pending">
  readonly progress: Observable<string | null>
  readonly approvals: ActionsHub
  readonly panels: SidePanels
  readonly popovers: ShellPopovers
  readonly settingsStack: ShellFace["settingsStack"]
  readonly connectorPanels: ConnectorPanelsFace
  readonly incidents: ShellFace["incidents"]
  readonly mainView: ShellFace["mainView"]
}

/**
 * The bot session shell in `main.conversation`, a single Slot where the
 * lowest priority renders alone: registered while bot-core occupies the main
 * view, once, at the fixed priority (README: Bot session shell).
 */
export function wireShell(
  ctx: ClientContext,
  sources: ShellSources,
): Observable<RegistrationStatus> {
  const { classification, actions } = sources
  const menu = createShellMenu()
  ctx.effect(() => {
    const disposers = builtinShellEntries({
      viewer: sources.files.viewer,
      panels: sources.panels,
      approvals: sources.approvals,
      connectors: sources.connectorPanels.connectors,
    }).map((entry) => menu.register(entry))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, "bot-core: bot session menu bar entries")

  const popoverHost = createPopoverHost()
  overlay(
    ctx,
    "bot-core.popovers",
    () => ({ host: popoverHost }) satisfies PopoverHostFace,
    PopoverHostView,
  )

  const face: ShellFace = {
    classification: classification.main,
    bots: sources.bots,
    rightbarRegistration: sources.rightbarRegistration,
    lockdownNotice: createNoticeDismissal(),
    menu,
    openSettings: sources.openSettings,
    status: actions.status,
    clearError: actions.clearError,
    files: sources.files,
    notes: sources.notes,
    progress: sources.progress,
    pending: actions.pending,
    approvals: sources.approvals,
    actionsWidth: createPanelWidth(ACTIONS_PANEL_WIDTH),
    panels: sources.panels,
    popovers: sources.popovers,
    settingsStack: sources.settingsStack,
    popoverHost,
    connectorPanels: sources.connectorPanels,
    incidents: sources.incidents,
    mainView: sources.mainView,
  }

  const status = createStore<RegistrationStatus>({ state: "idle" })
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.mainConversation, () => {
        const registration = createSlotRegistration({
          wanted: classification.occupies,
          label: "bot session shell",
          register: (priority) =>
            ctx.slots.register(
              {
                name: SLOT.mainConversation,
                priority,
                locale: NAMESPACE,
                children: { [CONNECTOR_PANEL_SLOT]: { kind: "keyed", scope: "session" } },
                inject: () => face,
              },
              ShellRoot,
            ),
        })
        const report = () => status.set(registration.getSnapshot())
        report()
        const off = registration.subscribe(report)
        return () => {
          registration.dispose()
          report()
          off()
        }
      }),
    "bot-core: bot session shell",
  )
  return status
}
