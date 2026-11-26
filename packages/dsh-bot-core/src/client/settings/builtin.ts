import { createElement } from "react"
import type { ChannelsHub } from "../channels-hub"
import type { ConnectionsFeed } from "../connections-model"
import type { ConnectorsHub } from "../connectors-hub"
import { IconChannels, IconConnectors, IconFolder, IconModel, IconUser } from "../icons"
import { derive } from "../observable"
import type { SendersFeed } from "../senders/model"
import { ChannelsSection, type ChannelsSectionDeps } from "./ChannelsSection"
import { ConnectorsSection, type ConnectorsSectionDeps } from "./ConnectorsSection"
import { channelsBadge } from "./channels-badge"
import { connectorsBadge } from "./connectors-badge"
import { GeneralSection, type GeneralSectionDeps } from "./GeneralSection"
import { ModelsSection, type ModelsSectionDeps } from "./ModelsSection"
import type { SettingsSection, SettingsSectionProps } from "./sections"
import { WorkspacesSection, type WorkspacesSectionDeps } from "./WorkspacesSection"

export const SETTINGS_SECTION = {
  general: "bot-core.general",
  models: "bot-core.models",
  workspaces: "bot-core.workspaces",
  channels: "bot-core.channels",
  connectors: "bot-core.connectors",
} as const

export interface BuiltinSectionDeps
  extends GeneralSectionDeps,
    ModelsSectionDeps,
    Pick<WorkspacesSectionDeps, "workspaces"> {
  readonly channels: ChannelsHub
  readonly connectors: ConnectorsHub
  readonly connections: ConnectionsFeed
  readonly senders: SendersFeed
  openConnectionSettings(): void
  openShared(channelId: string): void
  readonly text: ChannelsSectionDeps["text"] & ConnectorsSectionDeps["text"]
}

export function builtinSettingsSections(deps: BuiltinSectionDeps): SettingsSection[] {
  const general = (props: SettingsSectionProps) =>
    createElement(GeneralSection, {
      ...props,
      saveBot: deps.saveBot,
      deleteBot: deps.deleteBot,
      languages: deps.languages,
      groups: deps.groups,
      openGroups: deps.openGroups,
    })
  const models = (props: SettingsSectionProps) =>
    createElement(ModelsSection, { ...props, models: deps.models, readCatalog: deps.readCatalog })
  const workspaces = (props: SettingsSectionProps) =>
    createElement(WorkspacesSection, {
      ...props,
      workspaces: deps.workspaces,
      readCatalog: deps.readCatalog,
    })
  const channels = (props: SettingsSectionProps) =>
    createElement(ChannelsSection, {
      ...props,
      channels: deps.channels,
      text: deps.text,
      openShared: deps.openShared,
    })
  const connectors = (props: SettingsSectionProps) =>
    createElement(ConnectorsSection, {
      ...props,
      connectors: deps.connectors,
      connections: deps.connections,
      senders: deps.senders,
      openConnectionSettings: deps.openConnectionSettings,
      text: deps.text,
    })
  return [
    {
      id: SETTINGS_SECTION.general,
      order: 100,
      label: (t) => t("settings.general"),
      icon: IconUser,
      component: general,
    },
    {
      id: SETTINGS_SECTION.models,
      order: 175,
      label: (t) => t("settings.models"),
      icon: IconModel,
      component: models,
    },
    {
      id: SETTINGS_SECTION.workspaces,
      order: 185,
      label: (t) => t("settings.workspaces"),
      icon: IconFolder,
      component: workspaces,
    },
    {
      id: SETTINGS_SECTION.channels,
      order: 200,
      label: (t) => t("settings.channels"),
      icon: IconChannels,
      component: channels,
      badge: (botId) => derive([deps.channels.feed(botId)], channelsBadge),
    },
    {
      id: SETTINGS_SECTION.connectors,
      order: 300,
      label: (t) => t("settings.connectors"),
      icon: IconConnectors,
      component: connectors,
      badge: (botId) => derive([deps.connectors.feed(botId)], connectorsBadge),
    },
  ]
}
