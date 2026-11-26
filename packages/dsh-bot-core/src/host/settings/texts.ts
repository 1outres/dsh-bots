import type { BotChannelText } from "../../shared/channels"

export const SETTINGS_TOOL = "bot_settings"

export const SETTINGS_ACTIONS = ["describe", "change"] as const

export const SETTINGS_TOOL_DESCRIPTION =
  "Read and change your own settings: the ones your owner manages in your bot's settings in the DeepSeek Harness Web UI (your name and language, models, chat channels, connectors, skills, logins, your VM, Workspaces, the Main session and web lookup). " +
  "action=describe without area lists every area with one line per setting; with area it explains each setting: where it is in the Web UI, what it means for you, its value now, what it accepts and whether you may change it. " +
  "action=change changes settings of one area together, only when your owner asked you to in this turn: pass area, changes ([{ key, value }], each value in the form describe shows) and reason (shown to your owner). " +
  "A setting marked approve asks your owner first and the call waits for the answer; one marked never cannot be changed by you, so tell your owner where in the Web UI to change it. " +
  "Your owner sees every change in your settings and can undo it."

export const SETTINGS_TOOL_PARAMETERS = {
  action: "describe or change.",
  area: "The area id from describe, such as general or channels.discord. Optional for describe.",
  changes:
    'For change: the settings to change in that area, as [{ "key": "<setting key>", "value": <new value> }]. A list value is the whole new list.',
  reason: "For change: why, in one short sentence; your owner reads it in the change history.",
} as const

export const NOT_THE_OWNER =
  "you can change your settings only when your owner asks you to: this turn was not started by a message from your owner, so no setting changed. Tell your owner which setting to change, or ask them to ask you directly"

export const NO_TURN =
  "your settings can be changed only in a turn bot-core saw start; no setting changed. Try again in your next turn"

export const SETTING_CHANGES_LABEL: BotChannelText = {
  en: "Changes by the bot",
  ja: "ボットが変えた設定",
}
