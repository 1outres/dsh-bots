import { createElement } from "react"
import type { BotModelCatalog } from "../../shared/models"
import type { BotDeletion } from "../bot-deletion"
import type { ChannelsHub } from "../channels-hub"
import type { ConnectionsFeed } from "../connections-model"
import type { ConnectorsHub } from "../connectors-hub"
import { DeleteBotDialog, type DeleteBotFace } from "../DeleteBotDialog"
import { ConnectionsSettings } from "../global-settings/ConnectionsSettings"
import type { GroupsFeed } from "../groups/model"
import { GROUPS_SECTION } from "../groups/sections"
import { IconConnectors, IconKey } from "../icons"
import { localeFormat } from "../locale-format"
import type { ModelsHub } from "../models/feed"
import { derive, type Observable } from "../observable"
import type { SendersFeed } from "../senders/model"
import type { BotsState } from "../session-classification"
import { snapshotOf } from "../session-classification"
import { builtinSettingsSections } from "../settings/builtin"
import { dismissWhenGone } from "../settings/flow"
import { SettingsScreen, type SettingsScreenFace } from "../settings/SettingsScreen"
import type { ClientContext } from "../types"
import { LoginsSection } from "../vaults/LoginsSection"
import type { BotVaultsHub, VaultsFeed } from "../vaults/model"
import { openIncidentsOf } from "../vaults/model"
import { LOGINS_SECTION, VAULTS_SECTION } from "../vaults/sections"
import { VaultsSettings } from "../vaults/VaultsSettings"
import type { WorkspacesClient } from "../workspaces"
import type { BotActions } from "./bots-face"
import { sharedChannelSection } from "./channels-shared"
import { overlay } from "./dialogs"
import type { SettingsScreens } from "./screens"

export interface SettingsSources {
  readonly bots: Observable<BotsState>
  readonly screens: SettingsScreens
  readonly channels: ChannelsHub
  readonly connectors: ConnectorsHub
  readonly connections: ConnectionsFeed
  readonly senders: SendersFeed
  readonly vaults: VaultsFeed
  readonly logins: BotVaultsHub
  readonly groups: GroupsFeed
  readonly models: ModelsHub
  readonly workspaces: WorkspacesClient
  readCatalog(): Promise<BotModelCatalog>
  readonly actions: Pick<BotActions, "saveBot">
  readonly deletion: BotDeletion
}

export const CONNECTIONS_SECTION = "bot-core.connections"

export function wireSettings(ctx: ClientContext, sources: SettingsSources): void {
  const { bots, screens, channels, connectors, connections, actions, deletion } = sources
  const { flow, sections } = screens.bot
  ctx.effect(() => {
    const disposers = builtinSettingsSections({
      saveBot: actions.saveBot,
      deleteBot: deletion.ask,
      languages: () => ctx.locale.getSnapshot().locales,
      groups: sources.groups,
      openGroups: () => screens.openGlobalSettings(GROUPS_SECTION),
      channels,
      connectors,
      connections,
      senders: sources.senders,
      models: sources.models,
      workspaces: sources.workspaces,
      readCatalog: sources.readCatalog,
      openConnectionSettings: () => screens.openGlobalSettings(CONNECTIONS_SECTION),
      openShared: (channelId) => screens.openGlobalSettings(sharedChannelSection(channelId)),
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
  const text = (value: { readonly en: string; readonly ja?: string }) =>
    ctx.locale.resolveText({ ...value })
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: VAULTS_SECTION,
        order: 250,
        label: (t) => t("global.vaults"),
        icon: IconKey,
        component: (props) =>
          createElement(VaultsSettings, { ...props, vaults: sources.vaults, text }),
      }),
    "bot-core: password manager settings",
  )
  ctx.effect(
    () =>
      sections.register({
        id: LOGINS_SECTION,
        order: 320,
        label: (t) => t("settings.logins"),
        icon: IconKey,
        component: (props) =>
          createElement(LoginsSection, {
            ...props,
            logins: sources.logins,
            vaults: sources.vaults,
            openVaultSettings: () => screens.openGlobalSettings(VAULTS_SECTION),
          }),
        badge: (botId) =>
          derive([sources.vaults], (state) => {
            const count = openIncidentsOf(state)[botId]
            return count === undefined
              ? null
              : {
                  tone: "danger" as const,
                  label: (t) => localeFormat(t).count("bot.incidents", count),
                }
          }),
      }),
    "bot-core: logins settings",
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
