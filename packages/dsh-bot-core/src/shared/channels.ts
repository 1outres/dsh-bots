import { type BotSecretSettingAgent, type BotSettingAgent, settingAgentProblem } from "./settings"

export type BotChannelText = {
  readonly en: string
  readonly ja?: string
}

interface FieldBase<K extends string> {
  readonly key: K
  readonly label: BotChannelText
  readonly description?: BotChannelText
}

export interface BotChannelSharedSecretField<K extends string = string> extends FieldBase<K> {
  readonly kind: "secret"
  readonly required: boolean
  readonly maxLength: number
}

export interface BotChannelSecretField<K extends string = string>
  extends BotChannelSharedSecretField<K> {
  readonly agent: BotSecretSettingAgent
}

export interface BotChannelChoice {
  readonly value: string
  readonly label: BotChannelText
}

export interface BotChannelSharedTextField<K extends string = string> extends FieldBase<K> {
  readonly kind: "text"
  readonly required: boolean
  readonly maxLength: number
  readonly pattern?: string
  readonly placeholder?: string
  readonly choices?: readonly BotChannelChoice[]
}

export interface BotChannelTextField<K extends string = string>
  extends BotChannelSharedTextField<K> {
  readonly agent: BotSettingAgent
}

export interface BotChannelSharedPickField<K extends string = string> extends FieldBase<K> {
  readonly kind: "pick"
  readonly required: boolean
  readonly source: string
  readonly maxLength: number
  readonly pattern?: string
  readonly clears?: readonly string[]
}

export interface BotChannelPickField<K extends string = string>
  extends BotChannelSharedPickField<K> {
  readonly agent: BotSettingAgent
}

export interface BotChannelSharedListField<K extends string = string> extends FieldBase<K> {
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

export interface BotChannelListField<K extends string = string>
  extends BotChannelSharedListField<K> {
  readonly agent: BotSettingAgent
}

export type BotChannelSharedField =
  | BotChannelSharedSecretField
  | BotChannelSharedTextField
  | BotChannelSharedPickField
  | BotChannelSharedListField

export type BotChannelField =
  | BotChannelSecretField
  | BotChannelTextField
  | BotChannelPickField
  | BotChannelListField

export function sourceOf(field: BotChannelSharedField): string | undefined {
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

export const CHANNEL_OPTION_IMAGE =
  /^(?:https:\/\/\S+|data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*)$/

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

export interface BotChannelSnippet {
  readonly label: BotChannelText
  readonly language: "yaml" | "text"
  readonly text: string
}

export type BotChannelInspection =
  | {
      readonly state: "ready"
      readonly account?: string
      readonly links: readonly BotChannelInspectionLink[]
      readonly warnings: readonly BotChannelText[]
      readonly snippets?: readonly BotChannelSnippet[]
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
  | { readonly kind: "shared" }
  | {
      readonly kind: "shared-draft"
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
  readonly shared?: true
}

export interface BotChannelSharedDescriptor {
  readonly id: string
  readonly name: string
  readonly description?: BotChannelText
  readonly fields: readonly BotChannelSharedField[]
  readonly initial: boolean
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
  | { readonly state: "unconfigured" }
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
  readonly initial?: BotChannelInitialFailure
}

export interface BotChannelInitialFailure {
  readonly state: "failed"
  readonly reason: BotChannelText
  readonly at: number
}

export type BotChannelInitialSummary =
  | { readonly state: "ready"; readonly summary: BotChannelText }
  | { readonly state: "unavailable"; readonly reason: BotChannelText }

export type BotChannelSharedStatus =
  | { readonly state: "incomplete"; readonly missing: readonly string[] }
  | { readonly state: "ready" }

export interface BotChannelSharedView {
  readonly channel: BotChannelSharedDescriptor
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
  readonly newBots: boolean
  readonly initial?: BotChannelInitialSummary
  readonly status: BotChannelSharedStatus
  readonly enabledBots: number
  readonly revision: number
}

export interface BotChannelSharedSnapshot {
  readonly channels: readonly BotChannelSharedView[]
}

export interface BotChannelSharedChange {
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, BotChannelSecretChange>>
  readonly newBots: boolean
}

export type BotChannelSharedConfigureResult =
  | { readonly saved: true; readonly view: BotChannelSharedView }
  | { readonly saved: false; readonly reason: BotChannelText }

export interface BotChannelDefault {
  readonly channelId: string
  readonly name: string
  readonly initial: BotChannelInitialSummary
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
  watchShared(signal?: AbortSignal): AsyncIterable<BotChannelSharedSnapshot>
  configureShared(
    channelId: string,
    change: BotChannelSharedChange,
  ): Promise<BotChannelSharedConfigureResult>
  defaults(): Promise<readonly BotChannelDefault[]>
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

function checkChoices(field: BotChannelSharedTextField, what: string): void {
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

export function checkChannelDescriptor(channel: Omit<BotChannelDescriptor, "shared">): void {
  checkChannelIdentity(channel)
  checkChannelFields(channel.fields, `channel "${channel.id}"`, (field) =>
    settingAgentProblem(field.agent, field.kind === "secret"),
  )
  if (
    channel.owners !== undefined &&
    channel.fields.find((field) => field.key === channel.owners)?.kind !== "list"
  ) {
    throw new Error(`channel "${channel.id}": owners must name one of its list fields`)
  }
}

export function checkSharedChannelFields(
  channelId: string,
  fields: readonly BotChannelSharedField[],
): void {
  checkChannelFields(fields, `channel "${channelId}" shared settings`, (field) =>
    "agent" in field
      ? "shared settings are never shown to a bot, so they take no agent"
      : undefined,
  )
}

function checkChannelIdentity(channel: Omit<BotChannelDescriptor, "shared">): void {
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
}

function checkChannelFields<F extends BotChannelSharedField>(
  fields: readonly F[],
  owner: string,
  agentProblem: (field: F) => string | undefined,
): void {
  const keys = new Set<string>()
  for (const field of fields) {
    const what = `${owner} field "${field.key}"`
    if (!FIELD_KEY.test(field.key))
      throw new Error(`${what}: the key must be camelCase letters and digits`)
    if (keys.has(field.key)) throw new Error(`${what} is declared twice`)
    keys.add(field.key)
    checkText(field.label, `${what} label`)
    if (field.description !== undefined) checkText(field.description, `${what} description`)
    const agent = agentProblem(field)
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
  for (const field of fields) {
    if (field.kind !== "pick") continue
    for (const key of field.clears ?? []) {
      const cleared = fields.find((other) => other.key === key)
      if (
        cleared === undefined ||
        cleared === field ||
        (cleared.kind !== "pick" && cleared.kind !== "list")
      ) {
        throw new Error(`${owner} field "${field.key}": clears must name other pick or list fields`)
      }
    }
  }
}

export function channelValuesAfter(
  fields: readonly BotChannelSharedField[],
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

export function emptyChannelValues(
  fields: readonly BotChannelSharedField[],
): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = {}
  for (const field of fields) {
    if (field.kind === "text" || field.kind === "pick") values[field.key] = ""
    if (field.kind === "list") values[field.key] = []
  }
  return values
}

export function channelValuesOf(
  fields: readonly BotChannelSharedField[],
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

function parseTextValue(field: BotChannelSharedTextField, value: unknown): string {
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

function parsePickValue(field: BotChannelSharedPickField, value: unknown): string {
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

function parseListValue(field: BotChannelSharedListField, value: unknown): readonly string[] {
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

function parseSecretChange(
  field: BotChannelSharedSecretField,
  change: unknown,
): BotChannelSecretChange {
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
  fields: readonly BotChannelSharedField[],
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
  field: BotChannelSharedField,
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): boolean {
  if (field.kind === "secret") return field.required && !secretSet(field.key)
  if (field.kind === "text" || field.kind === "pick")
    return field.required && (values[field.key] ?? "") === ""
  return (values[field.key]?.length ?? 0) < field.minItems
}

export function missingChannelFields(
  fields: readonly BotChannelSharedField[],
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): string[] {
  return fields.filter((field) => isMissing(field, values, secretSet)).map((field) => field.key)
}

export function sharedChannelStatus(
  fields: readonly BotChannelSharedField[],
  values: BotChannelPublicValues,
  secrets: Readonly<Record<string, boolean>>,
): BotChannelSharedStatus {
  const missing = missingChannelFields(fields, values, (key) => secrets[key] === true)
  return missing.length > 0 ? { state: "incomplete", missing } : { state: "ready" }
}

export interface BotChannelDraftSettings {
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, string>>
}

export type ParsedChannelSettingsRef =
  | { readonly kind: "bot"; readonly botId: string }
  | ({ readonly kind: "draft" } & BotChannelDraftSettings)
  | { readonly kind: "shared" }
  | ({ readonly kind: "shared-draft" } & BotChannelDraftSettings)

function parseDraft(
  fields: readonly BotChannelSharedField[],
  ref: Record<string, unknown>,
): BotChannelDraftSettings {
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
  return { values: change.values, secrets: typed }
}

export function parseChannelSettingsRef(
  fields: readonly BotChannelSharedField[],
  sharedFields: readonly BotChannelSharedField[] | undefined,
  input: unknown,
): ParsedChannelSettingsRef {
  const ref = recordOf(input, "the settings")
  switch (ref.kind) {
    case "bot":
      if (typeof ref.botId !== "string" || ref.botId.length === 0)
        throw new Error("botId must be text")
      return { kind: "bot", botId: ref.botId }
    case "draft":
      return { kind: "draft", ...parseDraft(fields, ref) }
    case "shared":
    case "shared-draft":
      if (sharedFields === undefined) throw new Error("this channel has no shared settings")
      return ref.kind === "shared"
        ? { kind: "shared" }
        : { kind: "shared-draft", ...parseDraft(sharedFields, ref) }
    default:
      throw new Error("the settings must be a bot's, a draft, or the shared ones")
  }
}

export function parseSharedChange(
  fields: readonly BotChannelSharedField[],
  input: unknown,
): BotChannelSharedChange {
  const change = recordOf(input, "the change")
  if (typeof change.newBots !== "boolean") throw new Error("newBots must be true or false")
  const parsed = parseChannelChange(fields, {
    enabled: true,
    profileSync: false,
    values: change.values,
    secrets: change.secrets,
  })
  return { values: parsed.values, secrets: parsed.secrets, newBots: change.newBots }
}

export function withSecretValues(
  fields: readonly BotChannelSharedField[],
  values: BotChannelPublicValues,
  secrets: Readonly<Record<string, string>>,
): BotChannelPublicValues {
  const all: Record<string, string | readonly string[]> = { ...channelValuesOf(fields, values) }
  for (const field of fields) {
    if (field.kind === "secret") all[field.key] = secrets[field.key] ?? ""
  }
  return all
}

export function secretsAfterChange(
  fields: readonly BotChannelSharedField[],
  stored: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, BotChannelSecretChange>>,
): Readonly<Record<string, string>> {
  const secrets: Record<string, string> = { ...stored }
  for (const field of fields) {
    if (field.kind !== "secret") continue
    const edit = changes[field.key] ?? { op: "keep" }
    if (edit.op === "set") secrets[field.key] = edit.value
    if (edit.op === "clear") delete secrets[field.key]
  }
  return secrets
}

export function secretFlagsOf(
  fields: readonly BotChannelSharedField[],
  isSet: (key: string) => boolean,
): Readonly<Record<string, boolean>> {
  return Object.fromEntries(
    fields.filter((field) => field.kind === "secret").map((field) => [field.key, isSet(field.key)]),
  )
}

export function parseInitialChannels(input: unknown): readonly string[] {
  if (!Array.isArray(input)) throw new Error("channels must be a list of channel ids")
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== "string" || !CHANNEL_ID.test(item))
      throw new Error("channels must list channel ids")
    if (seen.has(item)) throw new Error(`channel "${item}" is listed twice`)
    seen.add(item)
  }
  return [...seen]
}
