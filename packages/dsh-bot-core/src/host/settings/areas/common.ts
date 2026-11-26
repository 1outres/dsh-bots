import type { BotChannelText } from "../../../shared/channels"
import type { BotSettingApplyResult, BotSettingChange } from "../../../shared/settings"

export const BOT_SETTINGS_PLACE: BotChannelText = { en: "Bot settings", ja: "ボットの設定" }

export const GLOBAL_SETTINGS_PLACE: BotChannelText = {
  en: "dsh-bots settings",
  ja: "dsh-bots の設定",
}

export function placeIn(
  parent: BotChannelText,
  ...names: readonly BotChannelText[]
): BotChannelText {
  const path = [parent, ...names]
  return {
    en: path.map((name) => name.en).join(" > "),
    ja: path.map((name) => name.ja ?? name.en).join(" > "),
  }
}

export const APPLIED: BotSettingApplyResult = { applied: true }

export function refused(error: unknown): BotSettingApplyResult {
  const message = error instanceof Error ? error.message : String(error)
  return { applied: false, reason: { en: message } }
}

export function changesByKey(
  changes: readonly BotSettingChange[],
): ReadonlyMap<string, BotSettingChange["value"]> {
  return new Map(changes.map((change) => [change.key, change.value]))
}

export function unknownKey(
  changes: readonly BotSettingChange[],
  known: readonly string[],
): BotSettingApplyResult | undefined {
  const unknown = changes.find((change) => !known.includes(change.key))
  return unknown === undefined
    ? undefined
    : { applied: false, reason: { en: `there is no setting "${unknown.key}" here` } }
}
