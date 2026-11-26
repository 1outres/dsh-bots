import type { BotSettingsArea } from "../../../settings-contract"
import type { BotChannelText } from "../../../shared/channels"
import {
  type BotHeartbeatView,
  formatActiveHours,
  type HeartbeatSettings,
  MAX_HEARTBEAT_MINUTES,
  MIN_HEARTBEAT_MINUTES,
  parseActiveHours,
} from "../../../shared/heartbeat"
import {
  type BotSettingEntry,
  type BotSettingValueShape,
  settingValue,
} from "../../../shared/settings"
import { APPLIED, BOT_SETTINGS_PLACE, changesByKey, placeIn, refused, unknownKey } from "./common"

export interface HeartbeatAreaDeps {
  view(botId: string): BotHeartbeatView
  configure(botId: string, settings: HeartbeatSettings): Promise<unknown>
}

const LABEL: BotChannelText = { en: "Heartbeat", ja: "ハートビート" }

const ENABLED = "enabled"
const INTERVAL = "intervalMinutes"
const HOURS = "activeHours"

const ALL_DAY: BotChannelText = { en: "All day", ja: "一日中" }

const INTERVAL_SHAPE: BotSettingValueShape = {
  kind: "integer",
  min: MIN_HEARTBEAT_MINUTES,
  max: MAX_HEARTBEAT_MINUTES,
}

const HOURS_SHAPE: BotSettingValueShape = {
  kind: "text",
  maxLength: 11,
  pattern: "(?:[01]\\d|2[0-3]):[0-5]\\d-(?:[01]\\d|2[0-3]):[0-5]\\d",
}

function entriesOf(settings: HeartbeatSettings): readonly BotSettingEntry[] {
  const hours = formatActiveHours(settings.activeHours)
  return [
    {
      key: ENABLED,
      label: { en: "On", ja: "オン" },
      agentNote:
        "Whether your heartbeat wakes your Main session now and then to handle connector events waiting for you and the checks in HEARTBEAT.md; it never wakes you when there is nothing.",
      value: settingValue({ kind: "toggle" }, settings.enabled),
      accepts: { kind: "toggle" },
      change: "free",
    },
    {
      key: INTERVAL,
      label: { en: "Every (minutes)", ja: "間隔（分）" },
      agentNote: "How often your heartbeat looks for something to do.",
      value: settingValue(INTERVAL_SHAPE, settings.intervalMinutes),
      accepts: INTERVAL_SHAPE,
      change: "free",
    },
    {
      key: HOURS,
      label: { en: "Active hours", ja: "動かす時間帯" },
      agentNote:
        "The hours of the day (HH:MM-HH:MM in your time zone; it may cross midnight) when your heartbeat runs; empty means all day.",
      value: hours === "" ? { raw: "", shown: ALL_DAY } : settingValue(HOURS_SHAPE, hours),
      accepts: HOURS_SHAPE,
      change: "free",
    },
  ]
}

export function createHeartbeatArea(deps: HeartbeatAreaDeps): BotSettingsArea {
  return {
    id: "heartbeat",
    label: LABEL,
    location: placeIn(BOT_SETTINGS_PLACE, LABEL),
    entries: async (botId) => entriesOf(deps.view(botId).settings),
    implied: () => [],
    async apply(botId, changes) {
      const unknown = unknownKey(changes, [ENABLED, INTERVAL, HOURS])
      if (unknown !== undefined) return unknown
      try {
        const current = deps.view(botId).settings
        const edits = changesByKey(changes)
        const enabled = edits.get(ENABLED)
        const interval = edits.get(INTERVAL)
        const hours = edits.get(HOURS)
        if (enabled !== undefined && typeof enabled !== "boolean") {
          throw new Error(`"${ENABLED}" must be true or false`)
        }
        if (interval !== undefined && typeof interval !== "number") {
          throw new Error(`"${INTERVAL}" must be a number`)
        }
        if (hours !== undefined && typeof hours !== "string") {
          throw new Error(`"${HOURS}" must be HH:MM-HH:MM or empty`)
        }
        const activeHours = hours === undefined ? current.activeHours : parseActiveHours(hours)
        await deps.configure(botId, {
          enabled: enabled ?? current.enabled,
          intervalMinutes: interval ?? current.intervalMinutes,
          ...(activeHours === undefined ? {} : { activeHours }),
        })
        return APPLIED
      } catch (error) {
        return refused(error)
      }
    },
  }
}
