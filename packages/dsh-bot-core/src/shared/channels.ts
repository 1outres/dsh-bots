/**
 * Bot channel settings: the schema a channel plugin declares, the values a bot
 * keeps for it and the state of its connection. Wire shapes shared by the Host
 * and the browser, and the rules both halves check values with.
 */

/** Text a channel plugin shows in the browser; English is required. */
export type BotChannelText = {
  readonly en: string
  readonly ja?: string
}

interface FieldBase<K extends string> {
  /** Stable key, lowercase camelCase letters and digits (e.g. "token"). */
  readonly key: K
  readonly label: BotChannelText
  readonly description?: BotChannelText
}

/** A secret (a token): stored in DSH's credential store, never sent to the browser. */
export interface BotChannelSecretField<K extends string = string> extends FieldBase<K> {
  readonly kind: "secret"
  readonly required: boolean
  readonly maxLength: number
}

/** One value an enumerated text field takes, as people pick it. */
export interface BotChannelChoice {
  readonly value: string
  readonly label: BotChannelText
}

/** One line of text, trimmed. An optional text left empty is "". */
export interface BotChannelTextField<K extends string = string> extends FieldBase<K> {
  readonly kind: "text"
  readonly required: boolean
  readonly maxLength: number
  /** Whole-value regular expression (anchors implied). */
  readonly pattern?: string
  readonly placeholder?: string
  /**
   * The only values it takes, picked from a list instead of typed. An
   * optional field lists `""` among them (its empty value); a required one does not.
   */
  readonly choices?: readonly BotChannelChoice[]
}

/** A list of distinct text items (e.g. user ids), trimmed, empty items dropped. */
export interface BotChannelListField<K extends string = string> extends FieldBase<K> {
  readonly kind: "list"
  readonly minItems: number
  readonly maxItems: number
  readonly item: {
    readonly maxLength: number
    /** Whole-item regular expression (anchors implied). */
    readonly pattern?: string
    readonly placeholder?: string
  }
}

export type BotChannelField = BotChannelSecretField | BotChannelTextField | BotChannelListField

/** What the browser needs to render a channel's settings form. */
export interface BotChannelDescriptor {
  /** Stable id, unique across channels: lowercase letters, digits and hyphens (e.g. "discord"). */
  readonly id: string
  /** Display name (a product name, not translated). */
  readonly name: string
  readonly description?: BotChannelText
  /** An https page that walks through setting the channel up. */
  readonly guide?: string
  /**
   * The steps that get what the fields ask for, one short line each (at most
   * {@link MAX_CHANNEL_SETUP_STEPS}); the welcome guide lists them.
   */
  readonly setup?: readonly BotChannelText[]
  readonly fields: readonly BotChannelField[]
  /**
   * The key of the list field naming the bot's owners in this channel (their
   * ids there): the people who can instruct the bot as its owner and decide
   * its connector actions. Absent, or an empty list: nobody there is the owner.
   */
  readonly owners?: string
}

/** Values of a channel's text and list fields, by key (secrets are never among them). */
export type BotChannelPublicValues = Readonly<Record<string, string | readonly string[]>>

/** A secret field's edit: keep the stored value, replace it, or remove it. */
export type BotChannelSecretChange =
  | { readonly op: "keep" }
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

/** One save of a bot's settings for a channel. Every text and list field is given; secrets default to keep. */
export interface BotChannelChange {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, BotChannelSecretChange>>
}

/** What a channel plugin reports about its connection for one bot. */
export type BotChannelConnectionState =
  | { readonly state: "connecting" }
  | { readonly state: "connected"; readonly account?: string }
  | { readonly state: "failed"; readonly message: string }

/**
 * A bot's channel as the browser shows it: `off` (not enabled),
 * `incomplete` (enabled, required fields missing), `waiting` (the bot has
 * no Main session yet), or the connection's own state.
 */
export type BotChannelStatus =
  | { readonly state: "off" }
  | { readonly state: "incomplete"; readonly missing: readonly string[] }
  | { readonly state: "waiting" }
  | BotChannelConnectionState

/** A bot's settings for one registered channel. */
export interface BotChannelView {
  readonly channel: BotChannelDescriptor
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  /** Whether each secret field holds a value; the value itself never leaves the Host. */
  readonly secrets: Readonly<Record<string, boolean>>
  readonly status: BotChannelStatus
}

/** What the `botChannels` Remote's `watch` streams for one bot. */
export interface BotChannelsSnapshot {
  readonly botId: string
  /** Every registered channel, by id. */
  readonly channels: readonly BotChannelView[]
}

/**
 * The `botChannels` Remote: each bot's channel settings. Secret values only
 * travel inward (`configure`); every view says whether a secret is set,
 * never what it is.
 */
export interface BotChannelsApi {
  /** The bot's settings for every registered channel, again after every change. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotChannelsSnapshot>
  /** Save the bot's settings for one channel (checked against its fields); the connection follows them. */
  configure(botId: string, channelId: string, change: BotChannelChange): Promise<BotChannelView>
}

const CHANNEL_ID = /^[a-z][a-z0-9-]*$/
const FIELD_KEY = /^[a-z][a-zA-Z0-9]*$/
/** Upper bound of a channel's setup steps. */
export const MAX_CHANNEL_SETUP_STEPS = 8

/** Upper bound of any one stored text value (a secret, a text, a list item). */
export const MAX_CHANNEL_VALUE_LENGTH = 4096
/** Upper bound of the items of one list field. */
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

/**
 * Check a channel's descriptor as a channel plugin declares it.
 * @throws naming the first problem.
 */
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
    switch (field.kind) {
      case "secret":
        checkLength(field.maxLength, `${what} maxLength`)
        break
      case "text":
        checkLength(field.maxLength, `${what} maxLength`)
        checkPattern(field.pattern, `${what} pattern`)
        checkChoices(field, what)
        break
      case "list":
        checkLength(field.item.maxLength, `${what} item.maxLength`)
        checkPattern(field.item.pattern, `${what} item.pattern`)
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
  if (
    channel.owners !== undefined &&
    channel.fields.find((field) => field.key === channel.owners)?.kind !== "list"
  ) {
    throw new Error(`channel "${channel.id}": owners must name one of its list fields`)
  }
}

/** The empty value of every text and list field. */
export function emptyChannelValues(fields: readonly BotChannelField[]): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = {}
  for (const field of fields) {
    if (field.kind === "text") values[field.key] = ""
    if (field.kind === "list") values[field.key] = []
  }
  return values
}

/** Stored values over the empty ones: a field declared later reads empty, an undeclared one is dropped. */
export function channelValuesOf(
  fields: readonly BotChannelField[],
  stored: BotChannelPublicValues,
): BotChannelPublicValues {
  const values: Record<string, string | readonly string[]> = { ...emptyChannelValues(fields) }
  for (const field of fields) {
    const value = stored[field.key]
    if (field.kind === "text" && typeof value === "string") values[field.key] = value
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

/**
 * Parse a change from outside (the browser) against a channel's fields: every
 * text and list field present and valid, secret changes only for secret
 * fields (absent ones are kept), nothing else.
 * @throws naming the first problem.
 */
export function parseChannelChange(
  fields: readonly BotChannelField[],
  input: unknown,
): BotChannelChange {
  const change = recordOf(input, "the change")
  if (typeof change.enabled !== "boolean") throw new Error("enabled must be true or false")
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
    if (field.kind === "list") parsedValues[field.key] = parseListValue(field, values[field.key])
    if (field.kind === "secret") {
      parsedSecrets[field.key] =
        secrets[field.key] === undefined
          ? { op: "keep" }
          : parseSecretChange(field, secrets[field.key])
    }
  }
  return { enabled: change.enabled, values: parsedValues, secrets: parsedSecrets }
}

function isMissing(
  field: BotChannelField,
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): boolean {
  if (field.kind === "secret") return field.required && !secretSet(field.key)
  if (field.kind === "text") return field.required && (values[field.key] ?? "") === ""
  return (values[field.key]?.length ?? 0) < field.minItems
}

/** Keys of the required fields that have no value. */
export function missingChannelFields(
  fields: readonly BotChannelField[],
  values: BotChannelPublicValues,
  secretSet: (key: string) => boolean,
): string[] {
  return fields.filter((field) => isMissing(field, values, secretSet)).map((field) => field.key)
}
