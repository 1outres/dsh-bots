import type { BotChannelText } from "./shared/channels"
import type { BotSettingApplyResult, BotSettingChange, BotSettingEntry } from "./shared/settings"

export type * from "./shared/settings"

export interface BotSettingsArea {
  readonly id: string
  readonly label: BotChannelText
  readonly location: BotChannelText
  entries(botId: string, signal: AbortSignal): Promise<readonly BotSettingEntry[]>
  implied(botId: string, changes: readonly BotSettingChange[]): readonly BotSettingChange[]
  apply(botId: string, changes: readonly BotSettingChange[]): Promise<BotSettingApplyResult>
}
