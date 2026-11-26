import type { BotChannel } from "../../../channel-contract"
import type { BotSettingsArea } from "../../../settings-contract"
import {
  type BotChannelChange,
  type BotChannelField,
  type BotChannelOptions,
  type BotChannelProfileParts,
  type BotChannelText,
  type BotChannelView,
  channelValuesAfter,
  profilePartsOf,
  sourceOf,
} from "../../../shared/channels"
import {
  type BotSettingChange,
  type BotSettingChoice,
  type BotSettingEntry,
  type BotSettingItemShape,
  type BotSettingValueShape,
  settingValue,
} from "../../../shared/settings"
import type { ChannelPanel } from "../../channels/panel"
import type { SettingsAreaSource } from "../catalog"
import { APPLIED, BOT_SETTINGS_PLACE, placeIn, refused } from "./common"

export interface ChannelAreasDeps {
  channels(): readonly BotChannel[]
  panel: Pick<ChannelPanel, "snapshot" | "configure" | "options">
}

const CHANNELS: BotChannelText = { en: "Channels", ja: "チャネル" }

const ENABLED = "enabled"
const PROFILE_SYNC = "profileSync"

const PROFILE_PARTS: Readonly<Record<BotChannelProfileParts, Required<BotChannelText>>> = {
  both: { en: "name and avatar", ja: "名前とアバター" },
  name: { en: "name", ja: "名前" },
  avatar: { en: "avatar", ja: "アバター" },
}

function profileSyncEntry(channel: BotChannel, view: BotChannelView): BotSettingEntry[] {
  if (view.profile === undefined) return []
  const parts = PROFILE_PARTS[profilePartsOf(view.profile.supports)]
  return [
    {
      key: PROFILE_SYNC,
      label: {
        en: `Sync the ${parts.en} to ${channel.name}`,
        ja: `${parts.ja}を ${channel.name} に反映`,
      },
      agentNote: `Whether your ${parts.en} on ${channel.name} follow your ${parts.en} here: when on, a change of yours shows there too.`,
      value: settingValue({ kind: "toggle" }, view.profile.sync),
      accepts: { kind: "toggle" },
      change: "approve",
    },
  ]
}

const SET: BotChannelText = { en: "Set (hidden)", ja: "設定済み（非表示）" }
const UNSET: BotChannelText = { en: "Not set", ja: "未設定" }

type Known = ReadonlyMap<string, readonly BotSettingChoice[]>

function textShape(
  maxLength: number,
  pattern: string | undefined,
  known: readonly BotSettingChoice[] | undefined,
): BotSettingItemShape {
  return {
    kind: "text",
    maxLength,
    ...(pattern === undefined ? {} : { pattern }),
    ...(known === undefined ? {} : { known }),
  }
}

function shapeOf(field: BotChannelField, known: Known): BotSettingValueShape | undefined {
  const source = sourceOf(field)
  const options = source === undefined ? undefined : known.get(source)
  switch (field.kind) {
    case "secret":
      return undefined
    case "text":
      return field.choices === undefined
        ? textShape(field.maxLength, field.pattern, undefined)
        : { kind: "choice", choices: field.choices }
    case "pick":
      return textShape(field.maxLength, field.pattern, options)
    case "list":
      return {
        kind: "list",
        minItems: field.minItems,
        maxItems: field.maxItems,
        item: textShape(field.item.maxLength, field.item.pattern, options),
      }
  }
}

function entryOf(view: BotChannelView, field: BotChannelField, known: Known): BotSettingEntry {
  const common = {
    key: field.key,
    label: field.label,
    ...(field.description === undefined ? {} : { description: field.description }),
    agentNote: field.agent.note,
  }
  if (field.kind === "secret") {
    const set = view.secrets[field.key] === true
    return { ...common, value: { raw: set, shown: set ? SET : UNSET }, change: "never" }
  }
  const accepts = shapeOf(field, known)
  const stored = view.values[field.key]
  const raw = field.kind === "list" ? (Array.isArray(stored) ? stored : []) : String(stored ?? "")
  return {
    ...common,
    value: settingValue(accepts, raw),
    ...(accepts === undefined ? {} : { accepts }),
    change: field.agent.change,
  }
}

const choicesOf = (options: BotChannelOptions): readonly BotSettingChoice[] | undefined =>
  options.state === "ready"
    ? options.options.map((option) => ({ value: option.value, label: option.label }))
    : undefined

function channelArea(channel: BotChannel, deps: ChannelAreasDeps): BotSettingsArea {
  const name: BotChannelText = { en: channel.name }
  const viewOf = (botId: string) => {
    const view = deps.panel.snapshot(botId).channels.find((item) => item.channel.id === channel.id)
    if (view === undefined) throw new Error(`channel "${channel.id}" is not registered`)
    return view
  }
  const knownOf = async (botId: string, signal: AbortSignal): Promise<Known> => {
    const sources = [...new Set(channel.fields.flatMap((field) => sourceOf(field) ?? []))]
    const read = await Promise.all(
      sources.map(async (source) => {
        try {
          const options = await deps.panel.options(
            channel.id,
            { kind: "bot", botId },
            source,
            signal,
          )
          return [source, choicesOf(options)] as const
        } catch {
          signal.throwIfAborted()
          return [source, undefined] as const
        }
      }),
    )
    return new Map(
      read.flatMap(([source, choices]) => (choices === undefined ? [] : [[source, choices]])),
    )
  }
  return {
    id: `channels.${channel.id}`,
    label: name,
    location: placeIn(BOT_SETTINGS_PLACE, CHANNELS, name),
    async entries(botId, signal) {
      const view = viewOf(botId)
      const known = await knownOf(botId, signal)
      return [
        {
          key: ENABLED,
          label: { en: "On", ja: "オン" },
          agentNote: `Whether you are connected to ${channel.name}: when off, nothing reaches you from there and nothing you write goes there.`,
          value: settingValue({ kind: "toggle" }, view.enabled),
          accepts: { kind: "toggle" },
          change: "approve",
        },
        ...profileSyncEntry(channel, view),
        ...channel.fields.map((field) => entryOf(view, field, known)),
      ]
    },
    implied(botId, changes) {
      const view = viewOf(botId)
      const given = new Set(changes.map((change) => change.key))
      return changes.flatMap(({ key, value }) => {
        const field = channel.fields.find((known) => known.key === key)
        if (field?.kind !== "pick" || value === view.values[key]) return []
        return (field.clears ?? []).flatMap((cleared): BotSettingChange[] => {
          if (given.has(cleared)) return []
          const target = channel.fields.find((known) => known.key === cleared)
          return [{ key: cleared, value: target?.kind === "list" ? [] : "" }]
        })
      })
    },
    async apply(botId, changes) {
      try {
        const view = viewOf(botId)
        const edits: Record<string, string | readonly string[]> = {}
        let enabled = view.enabled
        let profileSync = view.profile?.sync === true
        for (const { key, value } of changes) {
          const field = channel.fields.find((known) => known.key === key)
          if (key === ENABLED && typeof value === "boolean") enabled = value
          else if (key === PROFILE_SYNC && view.profile !== undefined && typeof value === "boolean")
            profileSync = value
          else if (
            field !== undefined &&
            field.kind !== "secret" &&
            (typeof value === "string" || Array.isArray(value))
          ) {
            edits[key] = value
          } else {
            throw new Error(`"${key}" cannot take ${JSON.stringify(value)}`)
          }
        }
        const change: BotChannelChange = {
          enabled,
          values: channelValuesAfter(channel.fields, view.values, edits),
          secrets: {},
          profileSync,
        }
        const result = await deps.panel.configure(botId, channel.id, change)
        return result.saved ? APPLIED : { applied: false, reason: result.reason }
      } catch (error) {
        return refused(error)
      }
    },
  }
}

export function channelAreas(deps: ChannelAreasDeps): SettingsAreaSource {
  return () => deps.channels().map((channel) => channelArea(channel, deps))
}
