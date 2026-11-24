import { createElement } from "react"
import type { ChannelsHub } from "../channels-hub"
import type { ConnectionsFeed } from "../connections-model"
import type { ConnectorsHub } from "../connectors-hub"
import { IconChannels, IconConnectors, IconFolder, IconModel, IconUser } from "../icons"
import { derive } from "../observable"
import { ChannelsSection, type ChannelsSectionDeps } from "./ChannelsSection"
import { ConnectorsSection, type ConnectorsSectionDeps } from "./ConnectorsSection"
import { channelsBadge } from "./channels-badge"
import { connectorsBadge } from "./connectors-badge"
import { GeneralSection, type GeneralSectionDeps } from "./GeneralSection"
import { ModelsSection, type ModelsSectionDeps } from "./ModelsSection"
import type { SettingsSection, SettingsSectionProps } from "./sections"
import { WorkspacesSection, type WorkspacesSectionDeps } from "./WorkspacesSection"

/** Ids of bot-core's own settings sections, for `openSettings`. */
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
  openConnectionSettings(): void
  readonly text: ChannelsSectionDeps["text"] & ConnectorsSectionDeps["text"]
}

/** bot-core's sections: General (name, avatar, time zone, language and Delete), Models, Workspaces, Channels and Connectors. */
export function builtinSettingsSections(deps: BuiltinSectionDeps): SettingsSection[] {
  const general = (props: SettingsSectionProps) =>
    createElement(GeneralSection, {
      ...props,
      saveBot: deps.saveBot,
      deleteBot: deps.deleteBot,
      languages: deps.languages,
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
    createElement(ChannelsSection, { ...props, channels: deps.channels, text: deps.text })
  const connectors = (props: SettingsSectionProps) =>
    createElement(ConnectorsSection, {
      ...props,
      connectors: deps.connectors,
      connections: deps.connections,
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
