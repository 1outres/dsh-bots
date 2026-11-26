import {
  CONNECTOR_EVENT_DELIVERIES,
  type ConnectionStatus,
  type ConnectorEventDelivery,
} from "./connections"
import {
  type BotEnvironmentMinimum,
  type BotEnvironmentSpec,
  type BotEnvironmentSpecKey,
  environmentShortfall,
  environmentShortfallText,
} from "./environment"
import { type BotSettingAgent, settingAgentProblem } from "./settings"

export type ConnectorJson =
  | null
  | boolean
  | number
  | string
  | readonly ConnectorJson[]
  | { readonly [key: string]: ConnectorJson }

export type ConnectorPermission = "allow" | "ask" | "disallow"

export const CONNECTOR_PERMISSIONS: readonly ConnectorPermission[] = ["allow", "ask", "disallow"]

export interface ConnectorPreviewField {
  readonly label: string
  readonly value: string
}

export interface ConnectorPreview {
  readonly title: string
  readonly fields: readonly ConnectorPreviewField[]
  readonly body?: string
}

export interface ConnectorToolPermission {
  readonly connectorId: string
  readonly tool: string
  readonly default: ConnectorPermission
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
  readonly accounts?: readonly ConnectorAccountPermission[]
}

export interface ConnectorAccountPermission {
  readonly connectionId: string
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
}

export interface ConnectorPermissionChange {
  readonly connectorId: string
  readonly tool: string
  readonly permission: ConnectorPermission | null
  readonly connectionId?: string
}

export type ConnectorDecision = "approve" | "reject"

export type ConnectorDecisionOrigin =
  | { readonly kind: "web" }
  | {
      readonly kind: "channel"
      readonly channelId: string
      readonly channelName: string
      readonly person: string
    }

export interface ConnectorDecisionRecord {
  readonly decision: ConnectorDecision
  readonly origin: ConnectorDecisionOrigin
  readonly at: number
}

export type ConnectorActionState =
  | "pending"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "rejected"
  | "expired"
  | "cancelled"

export const CONNECTOR_ACTION_STATES: readonly ConnectorActionState[] = [
  "pending",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "interrupted",
  "rejected",
  "expired",
  "cancelled",
]

export const TERMINAL_ACTION_STATES: readonly ConnectorActionState[] = [
  "succeeded",
  "failed",
  "interrupted",
  "rejected",
  "expired",
  "cancelled",
]

export function isTerminalActionState(state: ConnectorActionState): boolean {
  return TERMINAL_ACTION_STATES.includes(state)
}

export type ConnectorActionStatus =
  | { readonly state: "pending" }
  | { readonly state: "approved"; readonly decision: ConnectorDecisionRecord }
  | {
      readonly state: "executing"
      readonly decision: ConnectorDecisionRecord
      readonly startedAt: number
    }
  | {
      readonly state: "succeeded"
      readonly decision: ConnectorDecisionRecord
      readonly startedAt: number
      readonly finishedAt: number
      readonly result: ConnectorJson
      readonly text?: string
    }
  | {
      readonly state: "failed"
      readonly decision: ConnectorDecisionRecord
      readonly startedAt?: number
      readonly finishedAt: number
      readonly reason: string
    }
  | {
      readonly state: "interrupted"
      readonly decision: ConnectorDecisionRecord
      readonly startedAt: number
      readonly finishedAt: number
    }
  | { readonly state: "rejected"; readonly decision: ConnectorDecisionRecord }
  | { readonly state: "expired"; readonly finishedAt: number }
  | { readonly state: "cancelled"; readonly finishedAt: number }

export interface ConnectorAction {
  readonly id: string
  readonly botId: string
  readonly connectorId: string
  readonly tool: string
  readonly args: ConnectorJson
  readonly preview: ConnectorPreview
  readonly snapshot?: ConnectorJson
  readonly connectionId?: string
  readonly sessionId: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly status: ConnectorActionStatus
}

export interface ConnectorActionChange {
  readonly botId: string
  readonly action: ConnectorAction
}

export const CONNECTOR_DECISIONS: readonly ConnectorDecision[] = ["approve", "reject"]

export function isDecidable(state: ConnectorActionState): boolean {
  return state === "pending"
}

export interface ConnectorActionView {
  readonly id: string
  readonly botId: string
  readonly connector: {
    readonly id: string
    readonly name?: string
  }
  readonly tool: string
  readonly toolName: string
  readonly args: ConnectorJson
  readonly preview: ConnectorPreview
  readonly createdAt: number
  readonly expiresAt: number
  readonly status: ConnectorActionStatus
}

export type ConnectorDecisionRefusal = "not-approver" | "not-found" | "settled" | "closed"

export type ConnectorDecisionResult =
  | { readonly accepted: true; readonly action: ConnectorActionView }
  | { readonly accepted: false; readonly reason: "settled"; readonly action: ConnectorActionView }
  | { readonly accepted: false; readonly reason: Exclude<ConnectorDecisionRefusal, "settled"> }

export interface BotConnectorActionsSnapshot {
  readonly botId: string
  readonly actions: readonly ConnectorActionView[]
}

export interface ConnectorWaitingSnapshot {
  readonly waiting: Readonly<Record<string, number>>
}

export interface BotConnectorActionsApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorActionsSnapshot>
  watchWaiting(signal?: AbortSignal): AsyncIterable<ConnectorWaitingSnapshot>
  decide(
    botId: string,
    actionId: string,
    decision: ConnectorDecision,
  ): Promise<ConnectorDecisionResult>
}

export function connectorToolName(connectorId: string, tool: string): string {
  return `${connectorId}_${tool}`
}

export type ConnectorSessions = "main" | "bot"

export const CONNECTOR_SESSIONS: readonly ConnectorSessions[] = ["main", "bot"]

export interface ConnectorText {
  readonly en: string
  readonly ja?: string
}

interface SettingFieldBase<K extends string> {
  readonly key: K
  readonly label: ConnectorText
  readonly description?: ConnectorText
  readonly agent: BotSettingAgent
}

export interface ConnectorToggleField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "toggle"
  readonly default: boolean
}

export interface ConnectorChoiceField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "choice"
  readonly options: readonly { readonly value: string; readonly label: ConnectorText }[]
  readonly default: string
}

export interface ConnectorIntegerField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "integer"
  readonly min: number
  readonly max: number
  readonly default: number
}

export interface ConnectorTextField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "text"
  readonly maxLength: number
  readonly pattern?: string
  readonly default: string
}

export type ConnectorSettingField =
  | ConnectorToggleField
  | ConnectorChoiceField
  | ConnectorIntegerField
  | ConnectorTextField

export type ConnectorSettingValues = Readonly<Record<string, string | number | boolean>>

export interface BotConnectorChange {
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  readonly events?: ConnectorEventDelivery
}

export type ConnectorPreparationStage =
  | {
      readonly kind: "requirements"
      readonly connectors: readonly string[]
      readonly since: number
    }
  | { readonly kind: "queued"; readonly since: number }
  | {
      readonly kind: "running"
      readonly step?: string
      readonly since: number
    }

export const CONNECTOR_PREPARATION_STAGES = [
  "requirements",
  "queued",
  "running",
] as const satisfies readonly ConnectorPreparationStage["kind"][]

export type ConnectorReadiness =
  | { readonly state: "disabled" }
  | {
      readonly state: "unavailable"
      readonly cause: ConnectorUnavailableCause
      readonly reason: string
    }
  | {
      readonly state: "preparing"
      readonly since: number
      readonly stage: ConnectorPreparationStage
    }
  | { readonly state: "ready"; readonly since: number }
  | {
      readonly state: "failed"
      readonly reason: string
      readonly at: number
      readonly retryAt?: number
    }

export type ConnectorUnavailableCause = "accounts" | "environment" | "requirements"

export const CONNECTOR_READINESS_STATES = [
  "disabled",
  "unavailable",
  "preparing",
  "ready",
  "failed",
] as const satisfies readonly ConnectorReadiness["state"][]

export interface ConnectorToolDescriptor {
  readonly name: string
  readonly toolName: string
  readonly description: string
  readonly permission: ConnectorPermission
}

export interface ConnectorConnectionsDescriptor {
  readonly provider: string
  readonly scopes: readonly string[]
}

export interface ConnectorEventKind {
  readonly kind: string
  readonly label: ConnectorText
}

export interface ConnectorEventsDescriptor {
  readonly kinds: readonly ConnectorEventKind[]
  readonly delivery: Exclude<ConnectorEventDelivery, "off">
  readonly intervalMs: number
}

export const CONNECTOR_PANEL_ICONS = ["desktop", "browser", "mail", "calendar", "files"] as const

export type ConnectorPanelIcon = (typeof CONNECTOR_PANEL_ICONS)[number]

export function isConnectorPanelIcon(value: unknown): value is ConnectorPanelIcon {
  return (CONNECTOR_PANEL_ICONS as readonly unknown[]).includes(value)
}

export const CONNECTOR_PANEL_PRESENTATIONS = ["side", "popover"] as const

export type ConnectorPanelPresentation = (typeof CONNECTOR_PANEL_PRESENTATIONS)[number]

export function isConnectorPanelPresentation(value: unknown): value is ConnectorPanelPresentation {
  return (CONNECTOR_PANEL_PRESENTATIONS as readonly unknown[]).includes(value)
}

export interface ConnectorPanelDescriptor {
  readonly title: ConnectorText
  readonly icon: ConnectorPanelIcon
  readonly presentation: ConnectorPanelPresentation
  readonly streams: readonly string[]
}

export interface ConnectorRequest {
  readonly id: string
  readonly reason: string
  readonly since: number
}

export interface ConnectorStatus {
  readonly note?: ConnectorText
  readonly request?: ConnectorRequest
  readonly operatedBy?: "person"
}

export interface ConnectorPreparationDescriptor {
  readonly hint?: ConnectorText
}

export const BOT_CREATION_OPTIONS = ["workstation"] as const

export type BotCreationOption = (typeof BOT_CREATION_OPTIONS)[number]

export function isBotCreationOption(value: unknown): value is BotCreationOption {
  return (BOT_CREATION_OPTIONS as readonly unknown[]).includes(value)
}

export interface ConnectorDescriptor {
  readonly id: string
  readonly name: string
  readonly description?: ConnectorText
  readonly sessions: ConnectorSessions
  readonly settings: readonly ConnectorSettingField[]
  readonly minimumSpec: BotEnvironmentMinimum
  readonly requires: readonly string[]
  readonly preparation?: ConnectorPreparationDescriptor
  readonly tools: readonly ConnectorToolDescriptor[]
  readonly panel?: ConnectorPanelDescriptor
  readonly connections?: ConnectorConnectionsDescriptor
  readonly events?: ConnectorEventsDescriptor
}

export interface ConnectorSwitchSubject {
  readonly id: string
  readonly name: string
  readonly requires: readonly string[]
  readonly minimumSpec: BotEnvironmentMinimum
  readonly enabled: boolean
}

export type ConnectorSwitchBlock =
  | { readonly kind: "requirements-missing"; readonly connectors: readonly string[] }
  | { readonly kind: "requirements-off"; readonly connectors: readonly string[] }
  | { readonly kind: "required"; readonly connectors: readonly string[] }
  | { readonly kind: "spec"; readonly key: BotEnvironmentSpecKey; readonly need: number }
  | { readonly kind: "spec-unread" }

export function connectorSwitchBlock(
  connector: ConnectorSwitchSubject,
  registered: readonly ConnectorSwitchSubject[],
  enabled: boolean,
  spec: BotEnvironmentSpec | undefined,
): ConnectorSwitchBlock | undefined {
  if (connector.enabled === enabled) return undefined
  const byId = new Map(registered.map((entry) => [entry.id, entry]))
  if (enabled) {
    const missing = connector.requires.filter((id) => !byId.has(id))
    if (missing.length > 0) return { kind: "requirements-missing", connectors: missing }
    const off = connector.requires.flatMap((id) => {
      const required = byId.get(id)
      return required === undefined || required.enabled ? [] : [required.name]
    })
    if (off.length > 0) return { kind: "requirements-off", connectors: off }
    if (Object.keys(connector.minimumSpec).length === 0) return undefined
    if (spec === undefined) return { kind: "spec-unread" }
    const shortfall = environmentShortfall(connector.minimumSpec, spec)
    return shortfall === undefined ? undefined : { kind: "spec", ...shortfall }
  }
  const requiring = registered
    .filter((entry) => entry.enabled && entry.requires.includes(connector.id))
    .map((entry) => entry.name)
  return requiring.length === 0 ? undefined : { kind: "required", connectors: requiring }
}

export function connectorSwitchRefusal(name: string, block: ConnectorSwitchBlock): string {
  if (block.kind === "spec") return environmentShortfallText(name, block)
  if (block.kind === "spec-unread") {
    return `${name} cannot be turned on yet: the bot's VM spec is read once its environment is ready`
  }
  const listed = block.connectors.join(", ")
  const one = block.connectors.length === 1
  switch (block.kind) {
    case "requirements-missing":
      return `${name} cannot be turned on: it needs connectors that are not installed (${listed})`
    case "requirements-off":
      return `turn on ${listed} first: ${name} needs ${one ? "it" : "them"}`
    case "required":
      return `turn off ${listed} first: ${one ? "it needs" : "they need"} ${name}`
  }
}

export interface BotConnectorAccount {
  readonly connectionId: string
  readonly label: string
  readonly email?: string
  readonly status: ConnectionStatus
  readonly granted: boolean
}

export interface BotConnectorEventsView {
  readonly delivery: ConnectorEventDelivery
  readonly waiting: number
}

export interface BotConnectorView {
  readonly connector: ConnectorDescriptor
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  readonly readiness: ConnectorReadiness
  readonly permissions: readonly ConnectorToolPermission[]
  readonly accounts?: readonly BotConnectorAccount[]
  readonly events?: BotConnectorEventsView
  readonly status: ConnectorStatus
}

export interface BotConnectorsSnapshot {
  readonly botId: string
  readonly connectors: readonly BotConnectorView[]
  readonly spec?: BotEnvironmentSpec
}

export interface BotConnectorsApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorsSnapshot>
  configure(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView>
  setPermission(botId: string, change: ConnectorPermissionChange): Promise<BotConnectorView>
  retry(botId: string, connectorId: string): Promise<BotConnectorView>
}

export interface BotConnectorStreamsApi {
  open(
    botId: string,
    connectorId: string,
    stream: string,
    signal?: AbortSignal,
  ): AsyncIterable<ConnectorJson>
}

export const MAX_CONNECTOR_STREAMS = 8

const SETTING_KEY = /^[a-z][a-zA-Z0-9]*$/
export const MAX_CONNECTOR_TEXT_SETTING = 4096
export const MAX_CONNECTOR_CHOICES = 64

function wholeMatch(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, "u")
}

function textProblem(text: unknown, what: string): string | undefined {
  if (typeof text !== "object" || text === null) return `${what} is missing`
  const value = text as Record<string, unknown>
  if (typeof value.en !== "string" || value.en.trim() === "") return `${what} has no English text`
  if (value.ja !== undefined && typeof value.ja !== "string") return `${what}.ja is not text`
  return undefined
}

function fieldProblem(field: ConnectorSettingField, what: string): string | undefined {
  switch (field.kind) {
    case "toggle":
      return typeof field.default === "boolean"
        ? undefined
        : `${what}: default must be true or false`
    case "choice": {
      if (
        !Array.isArray(field.options) ||
        field.options.length === 0 ||
        field.options.length > MAX_CONNECTOR_CHOICES
      ) {
        return `${what}: options must list 1 to ${MAX_CONNECTOR_CHOICES} values`
      }
      const values = new Set<string>()
      for (const option of field.options) {
        if (typeof option.value !== "string" || option.value === "")
          return `${what}: an option has no value`
        if (values.has(option.value)) return `${what}: option "${option.value}" is listed twice`
        values.add(option.value)
        const label = textProblem(option.label, `${what} option "${option.value}" label`)
        if (label !== undefined) return label
      }
      return values.has(field.default) ? undefined : `${what}: default is not one of its options`
    }
    case "integer":
      if (
        !Number.isSafeInteger(field.min) ||
        !Number.isSafeInteger(field.max) ||
        field.min > field.max
      ) {
        return `${what}: min and max must be integers with min <= max`
      }
      return Number.isSafeInteger(field.default) &&
        field.default >= field.min &&
        field.default <= field.max
        ? undefined
        : `${what}: default must be an integer from min to max`
    case "text": {
      if (
        !Number.isSafeInteger(field.maxLength) ||
        field.maxLength < 1 ||
        field.maxLength > MAX_CONNECTOR_TEXT_SETTING
      ) {
        return `${what}: maxLength must be an integer from 1 to ${MAX_CONNECTOR_TEXT_SETTING}`
      }
      if (field.pattern !== undefined) {
        try {
          wholeMatch(field.pattern)
        } catch (error) {
          return `${what}: pattern is not a valid regular expression: ${String(error)}`
        }
      }
      try {
        parseSettingValue(field, field.default)
      } catch (error) {
        return `${what}: default is invalid: ${error instanceof Error ? error.message : String(error)}`
      }
      return undefined
    }
    default:
      return `${what} has an unknown kind`
  }
}

export function connectorSettingsProblem(fields: unknown): string | undefined {
  if (!Array.isArray(fields)) return "settings must be a list of fields"
  const keys = new Set<string>()
  for (const field of fields as ConnectorSettingField[]) {
    if (typeof field !== "object" || field === null) return "a settings field is not an object"
    const what = `settings field "${String(field.key)}"`
    if (typeof field.key !== "string" || !SETTING_KEY.test(field.key)) {
      return `${what}: the key must be camelCase letters and digits, starting with a lower-case letter`
    }
    if (keys.has(field.key)) return `${what} is declared twice`
    keys.add(field.key)
    const label = textProblem(field.label, `${what} label`)
    if (label !== undefined) return label
    if (field.description !== undefined) {
      const description = textProblem(field.description, `${what} description`)
      if (description !== undefined) return description
    }
    const agent = settingAgentProblem(field.agent, false)
    if (agent !== undefined) return `${what}: ${agent}`
    const problem = fieldProblem(field, what)
    if (problem !== undefined) return problem
  }
  return undefined
}

export type ConnectorSettingIssue =
  | { readonly kind: "type" }
  | { readonly kind: "choice" }
  | { readonly kind: "range"; readonly min: number; readonly max: number }
  | { readonly kind: "length"; readonly max: number }
  | { readonly kind: "format" }

export type ConnectorSettingCheck =
  | { readonly ok: true; readonly value: string | number | boolean }
  | { readonly ok: false; readonly issue: ConnectorSettingIssue }

const fits = (value: string | number | boolean): ConnectorSettingCheck => ({ ok: true, value })
const misfit = (issue: ConnectorSettingIssue): ConnectorSettingCheck => ({ ok: false, issue })

export function checkConnectorSetting(
  field: ConnectorSettingField,
  value: unknown,
): ConnectorSettingCheck {
  switch (field.kind) {
    case "toggle":
      return typeof value === "boolean" ? fits(value) : misfit({ kind: "type" })
    case "choice":
      if (typeof value !== "string") return misfit({ kind: "type" })
      return field.options.some((option) => option.value === value)
        ? fits(value)
        : misfit({ kind: "choice" })
    case "integer":
      if (typeof value !== "number") return misfit({ kind: "type" })
      return Number.isSafeInteger(value) && value >= field.min && value <= field.max
        ? fits(value)
        : misfit({ kind: "range", min: field.min, max: field.max })
    case "text": {
      if (typeof value !== "string") return misfit({ kind: "type" })
      const trimmed = value.trim()
      if (trimmed.length > field.maxLength) return misfit({ kind: "length", max: field.maxLength })
      if (
        trimmed !== "" &&
        field.pattern !== undefined &&
        !wholeMatch(field.pattern).test(trimmed)
      ) {
        return misfit({ kind: "format" })
      }
      return fits(trimmed)
    }
  }
}

function settingIssueMessage(field: ConnectorSettingField, issue: ConnectorSettingIssue): string {
  switch (field.kind) {
    case "toggle":
      return `${field.key} must be true or false`
    case "choice":
      return `${field.key} must be one of ${field.options.map((option) => option.value).join(", ")}`
    case "integer":
      return `${field.key} must be an integer from ${field.min} to ${field.max}`
    case "text":
      if (issue.kind === "length") return `${field.key} is longer than ${field.maxLength}`
      if (issue.kind === "format") return `${field.key} has an invalid format`
      return `${field.key} must be text`
  }
}

function parseSettingValue(
  field: ConnectorSettingField,
  value: unknown,
): string | number | boolean {
  const checked = checkConnectorSetting(field, value)
  if (!checked.ok) throw new Error(settingIssueMessage(field, checked.issue))
  return checked.value
}

export function defaultConnectorSettings(
  fields: readonly ConnectorSettingField[],
): ConnectorSettingValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.default]))
}

export function connectorSettingValuesOf(
  fields: readonly ConnectorSettingField[],
  stored: Readonly<Record<string, unknown>>,
): ConnectorSettingValues {
  const values: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    try {
      values[field.key] =
        stored[field.key] === undefined
          ? field.default
          : parseSettingValue(field, stored[field.key])
    } catch {
      values[field.key] = field.default
    }
  }
  return values
}

export interface ConnectorChangeShape {
  readonly settings: readonly ConnectorSettingField[]
  readonly events: boolean
}

export function parseConnectorChange(
  shape: ConnectorChangeShape,
  input: unknown,
): BotConnectorChange {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("the change must be an object")
  }
  const change = input as Record<string, unknown>
  for (const key of Object.keys(change)) {
    if (key !== "enabled" && key !== "values" && key !== "events")
      throw new Error(`"${key}" is not part of a change`)
  }
  const fields = shape.settings
  let events: ConnectorEventDelivery | undefined
  if (shape.events) {
    if (!CONNECTOR_EVENT_DELIVERIES.includes(change.events as ConnectorEventDelivery)) {
      throw new Error(`events must be one of ${CONNECTOR_EVENT_DELIVERIES.join(", ")}`)
    }
    events = change.events as ConnectorEventDelivery
  } else if (change.events !== undefined) {
    throw new Error("this connector reports no events")
  }
  if (typeof change.enabled !== "boolean") throw new Error("enabled must be true or false")
  const values = change.values
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error("values must be an object")
  }
  const given = values as Record<string, unknown>
  const known = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(given)) {
    if (!known.has(key)) throw new Error(`"${key}" is not a setting of this connector`)
  }
  const parsed: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    if (!(field.key in given)) throw new Error(`${field.key} is missing`)
    parsed[field.key] = parseSettingValue(field, given[field.key])
  }
  return {
    enabled: change.enabled,
    values: parsed,
    ...(events === undefined ? {} : { events }),
  }
}
