import { type BotSecretSettingAgent, type BotSettingAgent, settingAgentProblem } from "./settings"

export type BotChannelText = {
  readonly en: string
  readonly ja?: string
}

interface FieldBase<K extends string> {
  readonly key: K
  readonly label: BotChannelText
  readonly description?: BotChannelText
  readonly agent: BotSettingAgent
}

export interface BotChannelSecretField<K extends string = string>
  extends Omit<FieldBase<K>, "agent"> {
  readonly kind: "secret"
  readonly required: boolean
  readonly maxLength: number
  readonly agent: BotSecretSettingAgent
}

export interface BotChannelChoice {
  readonly value: string
  readonly label: BotChannelText
}

export interface BotChannelTextField<K extends string = string> extends FieldBase<K> {
  readonly kind: "text"
  readonly required: boolean
  readonly maxLength: number
  readonly pattern?: string
  readonly placeholder?: string
  readonly choices?: readonly BotChannelChoice[]
}

export interface BotChannelPickField<K extends string = string> extends FieldBase<K> {
  readonly kind: "pick"
  readonly required: boolean
  readonly source: string
  readonly maxLength: number
  readonly pattern?: string
  readonly clears?: readonly string[]
}

export interface BotChannelListField<K extends string = string> extends FieldBase<K> {
  readonly kind: "list"
  readonly minItems: number
  readonly maxItems: number
  readonly item: {
    readonly maxLength: number
    readonly pattern?: string
    readonly placeholder?: string
    readonly source?: string
  }
}

export type BotChannelField =
  | BotChannelSecretField
  | BotChannelTextField
  | BotChannelPickField
  | BotChannelListField

export function sourceOf(field: BotChannelField): string | undefined {
  if (field.kind === "pick") return field.source
  if (field.kind === "list") return field.item.source
  return undefined
}

export interface BotChannelOption {
  readonly value: string
  readonly label: BotChannelText
  readonly detail?: BotChannelText
  readonly image?: string
}

export type BotChannelOptions =
  | {
      readonly state: "ready"
      readonly options: readonly BotChannelOption[]
      readonly suggested: readonly string[]
    }
  | { readonly state: "unavailable"; readonly reason: BotChannelText }

export interface BotChannelInspectionLink {
  readonly label: BotChannelText
  readonly url: string
}

export type BotChannelInspection =
  | {
      readonly state: "ready"
      readonly account?: string
      readonly links: readonly BotChannelInspectionLink[]
      readonly warnings: readonly BotChannelText[]
    }
  | { readonly state: "unavailable"; readonly reason: BotChannelText }

export type BotChannelCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BotChannelText }

export type BotChannelSettingsRef =
  | { readonly kind: "bot"; readonly botId: string }
  | {
      readonly kind: "draft"
      readonly values: BotChannelPublicValues
      readonly secrets: Readonly<Record<string, string>>
    }

export interface BotChannelPerson {
  readonly displayName: string
  readonly handle: string
}

export interface BotChannelDescriptor {
  readonly id: string
  readonly name: string
  readonly description?: BotChannelText
  readonly guide?: string
  readonly setup?: readonly BotChannelText[]
  readonly fields: readonly BotChannelField[]
  readonly owners?: string
}

export type BotChannelPublicValues = Readonly<Record<string, string | readonly string[]>>

export type BotChannelSecretChange =
  | { readonly op: "keep" }
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

export interface BotChannelChange {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, BotChannelSecretChange>>
  readonly profileSync: boolean
}

export interface BotChannelProfileSupport {
  readonly name: boolean
  readonly avatar: boolean
}

export type BotChannelProfileParts = "both" | "name" | "avatar"

export function profilePartsOf(supports: BotChannelProfileSupport): BotChannelProfileParts {
  if (supports.name && supports.avatar) return "both"
  return supports.name ? "name" : "avatar"
}

export type BotChannelProfileStatus =
  | { readonly state: "syncing" }
  | { readonly state: "synced" }
  | { readonly state: "failed"; readonly problems: readonly BotChannelText[] }

export interface BotChannelProfileView {
  readonly supports: BotChannelProfileSupport
  readonly sync: boolean
  readonly status?: BotChannelProfileStatus
}

export type BotChannelConnectionState =
  | { readonly state: "connecting" }
  | {
      readonly state: "connected"
      readonly account?: string
      readonly people?: Readonly<Record<string, BotChannelPerson>>
    }
  | { readonly state: "failed"; readonly message: string }

export type BotChannelStatus =
  | { readonly state: "off" }
  | { readonly state: "incomplete"; readonly missing: readonly string[] }
  | { readonly state: "waiting" }
  | BotChannelConnectionState

export interface BotChannelView {
  readonly channel: BotChannelDescriptor
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
  readonly status: BotChannelStatus
  readonly revision: number
  readonly profile?: BotChannelProfileView
}

export type BotChannelConfigureResult =
  | { readonly saved: true; readonly view: BotChannelView }
  | { readonly saved: false; readonly reason: BotChannelText }

export interface BotChannelsSnapshot {
  readonly botId: string
  readonly channels: readonly BotChannelView[]
}

export interface BotChannelsApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotChannelsSnapshot>
  configure(
    botId: string,
    channelId: string,
    change: BotChannelChange,
  ): Promise<BotChannelConfigureResult>
  options(
    channelId: string,
    settings: BotChannelSettingsRef,
    source: string,
    signal?: AbortSignal,
  ): Promise<BotChannelOptions>
  inspect(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal?: AbortSignal,
  ): Promise<BotChannelInspection>
  check(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal?: AbortSignal,
  ): Promise<BotChannelCheck>
}

const CHANNEL_ID = /^[a-z][a-z0-9-]*$/
const FIELD_KEY = /^[a-z][a-zA-Z0-9]*$/
const SOURCE = /^[a-z][a-zA-Z0-9-]*$/
export const MAX_CHANNEL_SETUP_STEPS = 8

export const MAX_CHANNEL_VALUE_LENGTH = 4096
export const MAX_CHANNEL_LIST_ITEMS = 256

function wholeMatch(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, "u")
}

function checkText(text: unknown, what: string): void {
  if (typeof text !== "object" || text === null) throw new Error(`${what} is missing`)
  const value = text as Record<string, unknown>
  if (typeof value.en !== "string" || value.en.trim().length === 0) {
    throw new Error(`${what} has no English text`)
  }
  if (value.ja !== undefined && typeof value.ja !== "string")
    throw new Error(`${what}.ja is not text`)
}

function checkLength(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_CHANNEL_VALUE_LENGTH) {
    throw new Error(`${what} must be an integer from 1 to ${MAX_CHANNEL_VALUE_LENGTH}`)
  }
}

function checkChoices(field: BotChannelTextField, what: string): void {
  const { choices } = field
  if (choices === undefined) return
  if (choices.length === 0) throw new Error(`${what} choices list nothing`)
  const values = new Set<string>()
  for (const choice of choices) {
    if (values.has(choice.value))
      throw new Error(`${what} choice "${choice.value}" is listed twice`)
    values.add(choice.value)
    checkText(choice.label, `${what} choice "${choice.value}" label`)
    if (choice.value !== choice.value.trim() || choice.value.length > field.maxLength) {
      throw new Error(`${what} choice "${choice.value}" is not a value of the field`)
    }
  }
  if (values.has("") === field.required) {
    throw new Error(
      field.required
        ? `${what} is required, so its choices must not list ""`
        : `${what} is optional, so its choices must list ""`,
    )
  }
}

function checkPattern(pattern: string | undefined, what: string): void {
  if (pattern === undefined) return
  try {
    wholeMatch(pattern)
  } catch (error) {
    throw new Error(`${what} is not a valid regular expression: ${String(error)}`)
  }
}

function checkSource(source: string, what: string): void {
  if (!SOURCE.test(source)) throw new Error(`${what} must be letters, digits and hyphens`)
}

export function checkChannelDescriptor(channel: BotChannelDescriptor): void {
  if (!CHANNEL_ID.test(channel.id)) {
    throw new Error(`channel id "${channel.id}" must be lowercase letters, digits and hyphens`)
  }
  if (channel.name.trim().length === 0) throw new Error(`channel "${channel.id}" has no name`)
  if (channel.description !== undefined)
    checkText(channel.description, `channel "${channel.id}" description`)
  if (channel.guide !== undefined && !/^https:\/\/\S+$/.test(channel.guide)) {
    throw new Error(`channel "${channel.id}" guide must be an https URL`)
  }
  if (channel.setup !== undefined) {
    if (channel.setup.length === 0 || channel.setup.length > MAX_CHANNEL_SETUP_STEPS) {
      throw new Error(
        `channel "${channel.id}" setup must list 1 to ${MAX_CHANNEL_SETUP_STEPS} steps`,
      )
    }
    for (const [index, step] of channel.setup.entries()) {
      checkText(step, `channel "${channel.id}" setup step ${index + 1}`)
    }
  }
  const keys = new Set<string>()
  for (const field of channel.fields) {
    const what = `channel "${channel.id}" field "${field.key}"`
    if (!FIELD_KEY.test(field.key))
      throw new Error(`${what}: the key must be camelCase letters and digits`)
    if (keys.has(field.key)) throw new Error(`${what} is declared twice`)
    keys.add(field.key)
    checkText(field.label, `${what} label`)
    if (field.description !== undefined) checkText(field.description, `${what} description`)
    const agent = settingAgentProblem(field.agent, field.kind === "secret")
    if (agent !== undefined) throw new Error(`${what}: ${agent}`)
    switch (field.kind) {
      case "secret":
        checkLength(field.maxLength, `${what} maxLength`)
        break
      case "text":
        checkLength(field.maxLength, `${what} maxLength`)
        checkPattern(field.pattern, `${what} pattern`)
        checkChoices(field, what)
        break
      case "pick":
        checkLength(field.maxLength, `${what} maxLength`)
        checkPattern(field.pattern, `${what} pattern`)
        checkSource(field.source, `${what} source`)
        break
      case "list":
        checkLength(field.item.maxLength, `${what} item.maxLength`)
        checkPattern(field.item.pattern, `${what} item.pattern`)
        if (field.item.source !== undefined) checkSource(field.item.source, `${what} item.source`)
        if (
          !Number.isInteger(field.minItems) ||
          !Number.isInteger(field.maxItems) ||
          field.minItems < 0 ||
          field.maxItems < Math.max(1, field.minItems) ||
          field.maxItems > MAX_CHANNEL_LIST_ITEMS
        ) {
          throw new Error(
            `${what}: minItems and maxItems must satisfy 0 <= minItems <= maxItems <= ${MAX_CHANNEL_LIST_ITEMS}`,
          )
        }
        break
      default:
        throw new Error(`${what} has an unknown kind`)
    }
  }
  for (const field of channel.fields) {
    if (field.kind !== "pick") continue
    for (const key of field.clears ?? []) {
      const cleared = channel.fields.find((other) => other.key === key)
      if (
        cleared === undefined ||
        cleared === field ||
        (cleared.kind !== "pick" && cleared.kind !== "list")
      ) {
        throw new Error(
          `channel "${channel.id}" field "${field.key}": clears must name other pick or list fields`,
        )
      }
    }
  }
  if (
    channel.owners !== undefined &&
    channel.fields.find((field) => field.key === channel.owners)?.kind !== "list"
  ) {
    throw new Error(`channel "${channel.id}": owners must name one of its list fields`)
  }
}

export function channelValuesAfter(
  fields: readonly BotChannelField[],
  current: BotChannelPublicValues,
  edits: Readonly<Record<string, string | readonly string[]>>,
): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = { ...channelValuesOf(fields, current) }
  for (const field of fields) {
    const edited = edits[field.key]
    if (field.kind !== "pick" || edited === undefined || edited === values[field.key]) continue
    for (const key of field.clears ?? []) {
      if (edits[key] !== undefined) continue
      const cleared = fields.find((known) => known.key === key)
      values[key] = cleared?.kind === "list" ? [] : ""
    }
  }
  for (const [key, value] of Object.entries(edits)) values[key] = value
  return values
}

export function emptyChannelValues(fields: readonly BotChannelField[]): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = {}
  for (const field of fields) {
    if (field.kind === "text" || field.kind === "pick") values[field.key] = ""
    if (field.kind === "list") values[field.key] = []
  }
  return values
}

export function channelValuesOf(
  fields: readonly BotChannelField[],
  stored: BotChannelPublicValues,
): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = { ...emptyChannelValues(fields) }
  for (const field of fields) {
    const value = stored[field.key]
    if ((field.kind === "text" || field.kind === "pick") && typeof value === "string")
      values[field.key] = value
    if (field.kind === "list" && Array.isArray(value)) values[field.key] = value
  }
  return values
}

function parseTextValue(field: BotChannelTextField, value: unknown): string {
  if (typeof value !== "string") throw new Error(`${field.key} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > field.maxLength)
    throw new Error(`${field.key} is longer than ${field.maxLength}`)
  if (
    trimmed.length > 0 &&
    field.pattern !== undefined &&
    !wholeMatch(field.pattern).test(trimmed)
  ) {
    throw new Error(`${field.key} has an invalid format`)
  }
  if (field.choices !== undefined && !field.choices.some((choice) => choice.value === trimmed)) {
    throw new Error(`${field.key} must be one of its choices`)
  }
  return trimmed
}

function parsePickValue(field: BotChannelPickField, value: unknown): string {
  if (typeof value !== "string") throw new Error(`${field.key} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > field.maxLength)
    throw new Error(`${field.key} is longer than ${field.maxLength}`)
  if (
    trimmed.length > 0 &&
    field.pattern !== undefined &&
    !wholeMatch(field.pattern).test(trimmed)
  ) {
    throw new Error(`${field.key} has an invalid format`)
  }
  return trimmed
}

function parseListValue(field: BotChannelListField, value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field.key} must be a list`)
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${field.key} must list text items`)
    const trimmed = item.trim()
    if (trimmed.length === 0 || items.includes(trimmed)) continue
    if (trimmed.length > field.item.maxLength) {
      throw new Error(`an item of ${field.key} is longer than ${field.item.maxLength}`)
    }
    if (field.item.pattern !== undefined && !wholeMatch(field.item.pattern).test(trimmed)) {
      throw new Error(`"${trimmed}" is not a valid item of ${field.key}`)
    }
    items.push(trimmed)
  }
  if (items.length > field.maxItems)
    throw new Error(`${field.key} lists more than ${field.maxItems} items`)
  return items
}

function parseSecretChange(field: BotChannelSecretField, change: unknown): BotChannelSecretChange {
  if (typeof change !== "object" || change === null) throw new Error(`${field.key}: invalid change`)
  const value = change as Record<string, unknown>
  if (value.op === "keep" || value.op === "clear") return { op: value.op }
  if (value.op === "set") {
    if (typeof value.value !== "string") throw new Error(`${field.key} must be text`)
    const trimmed = value.value.trim()
    if (trimmed.length === 0) throw new Error(`${field.key} is empty; clear it instead`)
    if (trimmed.length > field.maxLength)
      throw new Error(`${field.key} is longer than ${field.maxLength}`)
    return { op: "set", value: trimmed }
  }
  throw new Error(`${field.key}: unknown change`)
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

export function parseChannelChange(
  fields: readonly BotChannelField[],
  input: unknown,
): BotChannelChange {
  const change = recordOf(input, "the change")
  if (typeof change.enabled !== "boolean") throw new Error("enabled must be true or false")
  if (typeof change.profileSync !== "boolean") throw new Error("profileSync must be true or false")
  const values = recordOf(change.values, "values")
  const secrets = recordOf(change.secrets, "secrets")
  const known = new Map(fields.map((field) => [field.key, field]))
  for (const key of Object.keys(values)) {
    const field = known.get(key)
    if (field === undefined || field.kind === "secret")
      throw new Error(`"${key}" is not a value of this channel`)
  }
  for (const key of Object.keys(secrets)) {
    if (known.get(key)?.kind !== "secret")
      throw new Error(`"${key}" is not a secret of this channel`)
  }
  const parsedValues: Record<string, string | readonly string[]> = {}
  const parsedSecrets: Record<string, BotChannelSecretChange> = {}
  for (const field of fields) {
    if (field.kind === "text") parsedValues[field.key] = parseTextValue(field, values[field.key])
    if (field.kind === "pick") parsedValues[field.key] = parsePickValue(field, values[field.key])
    if (field.kind === "list") parsedValues[field.key] = parseListValue(field, values[field.key])
    if (field.kind === "secret") {
      parsedSecrets[field.key] =
        secrets[field.key] === undefined
          ? { op: "keep" }
          : parseSecretChange(field, secrets[field.key])
    }
  }
  return {
    enabled: change.enabled,
    values: parsedValues,
    secrets: parsedSecrets,
    profileSync: change.profileSync,
  }
}

function isMissing(
  field: BotChannelField,
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): boolean {
  if (field.kind === "secret") return field.required && !secretSet(field.key)
  if (field.kind === "text" || field.kind === "pick")
    return field.required && (values[field.key] ?? "") === ""
  return (values[field.key]?.length ?? 0) < field.minItems
}

export function missingChannelFields(
  fields: readonly BotChannelField[],
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): string[] {
  return fields.filter((field) => isMissing(field, values, secretSet)).map((field) => field.key)
}

export interface BotChannelDraftSettings {
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, string>>
}

export function parseChannelSettingsRef(
  fields: readonly BotChannelField[],
  input: unknown,
):
  | { readonly kind: "bot"; readonly botId: string }
  | ({ readonly kind: "draft" } & BotChannelDraftSettings) {
  const ref = recordOf(input, "the settings")
  if (ref.kind === "bot") {
    if (typeof ref.botId !== "string" || ref.botId.length === 0)
      throw new Error("botId must be text")
    return { kind: "bot", botId: ref.botId }
  }
  if (ref.kind !== "draft") throw new Error("the settings must be a bot's or a draft")
  const secrets = recordOf(ref.secrets, "secrets")
  const change = parseChannelChange(fields, {
    enabled: true,
    profileSync: false,
    values: ref.values,
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([key, value]) => [key, { op: "set", value }]),
    ),
  })
  const typed: Record<string, string> = {}
  for (const [key, edit] of Object.entries(change.secrets)) {
    if (edit.op === "set") typed[key] = edit.value
  }
  return { kind: "draft", values: change.values, secrets: typed }
}
