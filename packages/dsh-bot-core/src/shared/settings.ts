import type { BotChannelText } from "./channels"

export const BOT_SETTING_CHANGE_RULES = ["free", "approve", "never"] as const

export type BotSettingChangeRule = (typeof BOT_SETTING_CHANGE_RULES)[number]

export interface BotSettingAgent {
  readonly note: string
  readonly change: BotSettingChangeRule
}

export interface BotSecretSettingAgent {
  readonly note: string
}

export interface BotSettingDirectionalChange {
  readonly kind: "directional"
  readonly strictness: Readonly<Record<string, number>>
  readonly tighten: BotSettingChangeRule
  readonly loosen: BotSettingChangeRule
}

export type BotSettingChangePolicy = BotSettingChangeRule | BotSettingDirectionalChange

export type BotSettingJson = null | boolean | number | string | readonly string[]

export interface BotSettingValue {
  readonly raw: BotSettingJson
  readonly shown: BotChannelText
}

export interface BotSettingChoice {
  readonly value: string
  readonly label: BotChannelText
}

export type BotSettingItemShape =
  | {
      readonly kind: "text"
      readonly maxLength: number
      readonly pattern?: string
      readonly known?: readonly BotSettingChoice[]
    }
  | { readonly kind: "choice"; readonly choices: readonly BotSettingChoice[] }

export type BotSettingValueShape =
  | { readonly kind: "toggle" }
  | { readonly kind: "integer"; readonly min: number; readonly max: number }
  | BotSettingItemShape
  | {
      readonly kind: "list"
      readonly minItems: number
      readonly maxItems: number
      readonly item: BotSettingItemShape
    }

export interface BotSettingEntry {
  readonly key: string
  readonly label: BotChannelText
  readonly description?: BotChannelText
  readonly agentNote: string
  readonly value: BotSettingValue
  readonly accepts?: BotSettingValueShape
  readonly change: BotSettingChangePolicy
}

export interface BotSettingChange {
  readonly key: string
  readonly value: BotSettingJson
}

export type BotSettingApplyResult =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: BotChannelText }

export type BotSettingApprover =
  | { readonly kind: "web" }
  | { readonly kind: "channel"; readonly channelId: string; readonly channelName: string }

export interface BotSettingChangeItem {
  readonly key: string
  readonly label: BotChannelText
  readonly before: BotSettingValue
  readonly after: BotSettingValue
}

export interface BotSettingChangeRecord {
  readonly id: string
  readonly botId: string
  readonly at: number
  readonly area: string
  readonly areaLabel: BotChannelText
  readonly location: BotChannelText
  readonly items: readonly BotSettingChangeItem[]
  readonly reason: string
  readonly approvedBy?: BotSettingApprover
  readonly sessionId: string
  readonly revertedAt?: number
}

export type BotSettingRevertState =
  | { readonly state: "checking" }
  | { readonly state: "available" }
  | { readonly state: "superseded" }
  | { readonly state: "reverted"; readonly at: number }
  | { readonly state: "unavailable"; readonly reason: BotChannelText }

export interface BotSettingHistoryRow {
  readonly change: BotSettingChangeRecord
  readonly revert: BotSettingRevertState
}

export interface BotSettingsHistoryView {
  readonly botId: string
  readonly rows: readonly BotSettingHistoryRow[]
}

export type BotSettingRevertResult =
  | { readonly reverted: true; readonly view: BotSettingsHistoryView }
  | { readonly reverted: false; readonly reason: BotChannelText }

export interface BotSettingsApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotSettingsHistoryView>
  revert(botId: string, changeId: string): Promise<BotSettingRevertResult>
}

export const SETTING_CHANGES_KEPT = 200
export const MAX_SETTING_NOTE_LENGTH = 400
export const MAX_SETTING_REASON_LENGTH = 500

const AREA_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$/

export function settingAreaIdProblem(id: string): string | undefined {
  return AREA_ID.test(id)
    ? undefined
    : `settings area id "${id}" must be lower-case words, optionally "<group>.<name>"`
}

export function settingAgentProblem(agent: unknown, secret: boolean): string | undefined {
  if (typeof agent !== "object" || agent === null) return "agent is missing"
  const value = agent as Record<string, unknown>
  if (typeof value.note !== "string" || value.note.trim() === "") return "agent.note is empty"
  if (value.note.length > MAX_SETTING_NOTE_LENGTH) {
    return `agent.note is longer than ${MAX_SETTING_NOTE_LENGTH}`
  }
  if (secret) {
    return value.change === undefined ? undefined : "a secret takes no agent.change: it is never"
  }
  return (BOT_SETTING_CHANGE_RULES as readonly unknown[]).includes(value.change)
    ? undefined
    : `agent.change must be one of ${BOT_SETTING_CHANGE_RULES.join(", ")}`
}

export function sameSettingJson(left: BotSettingJson, right: BotSettingJson): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    )
  }
  return left === right
}

const STRICTER = 1
const LOOSER = -1

export function changeRuleOf(
  policy: BotSettingChangePolicy,
  before: BotSettingJson,
  after: BotSettingJson,
): BotSettingChangeRule {
  if (typeof policy === "string") return policy
  const rank = (value: BotSettingJson) =>
    typeof value === "string" ? policy.strictness[value] : undefined
  const from = rank(before)
  const to = rank(after)
  if (from === undefined || to === undefined) return policy.loosen
  const direction = Math.sign(to - from)
  if (direction === STRICTER) return policy.tighten
  if (direction === LOOSER) return policy.loosen
  return policy.tighten
}

function wholeMatch(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, "u")
}

function itemProblem(shape: BotSettingItemShape, value: unknown): string | undefined {
  if (typeof value !== "string") return "must be text"
  if (shape.kind === "choice") {
    return shape.choices.some((choice) => choice.value === value)
      ? undefined
      : `must be one of ${shape.choices.map((choice) => JSON.stringify(choice.value)).join(", ")}`
  }
  if (value.length > shape.maxLength) return `is longer than ${shape.maxLength}`
  if (value !== "" && shape.pattern !== undefined && !wholeMatch(shape.pattern).test(value)) {
    return "has an invalid format"
  }
  return undefined
}

export function settingValueProblem(
  shape: BotSettingValueShape,
  value: unknown,
): string | undefined {
  switch (shape.kind) {
    case "toggle":
      return typeof value === "boolean" ? undefined : "must be true or false"
    case "integer":
      return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= shape.min &&
        value <= shape.max
        ? undefined
        : `must be an integer from ${shape.min} to ${shape.max}`
    case "text":
    case "choice":
      return itemProblem(shape, value)
    case "list": {
      if (!Array.isArray(value)) return "must be a list of text"
      if (value.length < shape.minItems || value.length > shape.maxItems) {
        return `must list ${shape.minItems} to ${shape.maxItems} items`
      }
      if (new Set(value).size !== value.length) return "lists an item twice"
      for (const item of value) {
        const problem = itemProblem(shape.item, item)
        if (problem !== undefined) return `has an item that ${problem}`
      }
      return undefined
    }
  }
}

const ON: BotChannelText = { en: "On", ja: "オン" }
const OFF: BotChannelText = { en: "Off", ja: "オフ" }
const NONE: BotChannelText = { en: "(none)", ja: "（なし）" }
const EMPTY: BotChannelText = { en: "(empty)", ja: "（空）" }

const plain = (text: string): BotChannelText => ({ en: text })

function joined(texts: readonly BotChannelText[]): BotChannelText {
  if (texts.length === 0) return NONE
  const en = texts.map((text) => text.en).join(", ")
  const ja = texts.some((text) => text.ja !== undefined)
    ? texts.map((text) => text.ja ?? text.en).join("、")
    : undefined
  return ja === undefined ? { en } : { en, ja }
}

function itemShown(shape: BotSettingItemShape | undefined, value: string): BotChannelText {
  const choices = shape?.kind === "choice" ? shape.choices : shape?.known
  const label = choices?.find((choice) => choice.value === value)?.label
  if (label !== undefined) return label
  return value === "" ? EMPTY : plain(value)
}

export function shownSettingValue(
  shape: BotSettingValueShape | undefined,
  value: BotSettingJson,
): BotChannelText {
  if (typeof value === "boolean") return value ? ON : OFF
  if (typeof value === "number") return plain(String(value))
  if (value === null) return NONE
  if (typeof value === "string") {
    return itemShown(shape?.kind === "text" || shape?.kind === "choice" ? shape : undefined, value)
  }
  const item = shape?.kind === "list" ? shape.item : undefined
  return joined(value.map((entry) => itemShown(item, entry)))
}

export function settingValue(
  shape: BotSettingValueShape | undefined,
  raw: BotSettingJson,
): BotSettingValue {
  return { raw, shown: shownSettingValue(shape, raw) }
}

export function pickSettingText(text: BotChannelText, language: string | undefined): string {
  return language?.toLowerCase().startsWith("ja") === true && text.ja !== undefined
    ? text.ja
    : text.en
}
