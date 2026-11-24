import { createElement } from "react"
import type { BotModelCatalog } from "../../shared/models"
import type { BotDeletion } from "../bot-deletion"
import type { ChannelsHub } from "../channels-hub"
import type { ConnectionsFeed } from "../connections-model"
import type { ConnectorsHub } from "../connectors-hub"
import { DeleteBotDialog, type DeleteBotFace } from "../DeleteBotDialog"
import { ConnectionsSettings } from "../global-settings/ConnectionsSettings"
import { IconConnectors } from "../icons"
import type { ModelsHub } from "../models/feed"
import { derive, type Observable } from "../observable"
import type { BotsState } from "../session-classification"
import { snapshotOf } from "../session-classification"
import { builtinSettingsSections } from "../settings/builtin"
import { dismissWhenGone } from "../settings/flow"
import { SettingsScreen, type SettingsScreenFace } from "../settings/SettingsScreen"
import type { ClientContext } from "../types"
import type { WorkspacesClient } from "../workspaces"
import type { BotActions } from "./bots-face"
import { overlay } from "./dialogs"
import type { SettingsScreens } from "./screens"

export interface SettingsSources {
  readonly bots: Observable<BotsState>
  readonly screens: SettingsScreens
  readonly channels: ChannelsHub
  readonly connectors: ConnectorsHub
  readonly connections: ConnectionsFeed
  readonly models: ModelsHub
  readonly workspaces: WorkspacesClient
  readCatalog(): Promise<BotModelCatalog>
  readonly actions: Pick<BotActions, "saveBot">
  readonly deletion: BotDeletion
}

/** The dsh-bots settings section of connections (providers' OAuth clients, every account). */
export const CONNECTIONS_SECTION = "bot-core.connections"

/**
 * A bot's settings screen: bot-core's sections, the screen in `shell.overlay`,
 * closed once its bot is gone, and the confirmation of a bot's deletion over it.
 */
export function wireSettings(ctx: ClientContext, sources: SettingsSources): void {
  const { bots, screens, channels, connectors, connections, actions, deletion } = sources
  const { flow, sections } = screens.bot
  ctx.effect(() => {
    const disposers = builtinSettingsSections({
      saveBot: actions.saveBot,
      deleteBot: deletion.ask,
      languages: () => ctx.locale.getSnapshot().locales,
      channels,
      connectors,
      connections,
      models: sources.models,
      workspaces: sources.workspaces,
      readCatalog: sources.readCatalog,
      openConnectionSettings: () => screens.openGlobalSettings(CONNECTIONS_SECTION),
      text: (text) => ctx.locale.resolveText({ ...text }),
    }).map((section) => sections.register(section))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, "bot-core: settings sections")
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: CONNECTIONS_SECTION,
        order: 200,
        label: (t) => t("global.connections"),
        icon: IconConnectors,
        component: (props) => createElement(ConnectionsSettings, { ...props, connections }),
      }),
    "bot-core: connections settings",
  )
  ctx.effect(
    () => dismissWhenGone(flow, derive([bots], snapshotOf)),
    "bot-core: close the settings of a deleted bot",
  )
  ctx.effect(() => () => screens.dispose(), "bot-core: settings flows")
  overlay(
    ctx,
    "bot-core.settings",
    () => ({ bots, flow, sections, stack: screens.stack }) satisfies SettingsScreenFace,
    SettingsScreen,
  )
  overlay(
    ctx,
    "bot-core.delete-bot",
    () => ({ bots, deletion }) satisfies DeleteBotFace,
    DeleteBotDialog,
  )
}
