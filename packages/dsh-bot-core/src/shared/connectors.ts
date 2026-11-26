/**
 * Connectors' wire shapes shared by the Host, the browser and the connector
 * contract: tool permissions, the preview a person decides on, the connector
 * action ledger's states as others see them, a bot's settings and readiness
 * of each connector, and the `botConnectors` Remote.
 */

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

/** Lossless JSON, as tool arguments and results are. */
export type ConnectorJson =
  | null
  | boolean
  | number
  | string
  | readonly ConnectorJson[]
  | { readonly [key: string]: ConnectorJson }

/**
 * What a bot may do with one connector tool:
 * - `allow`: the call runs at once;
 * - `ask`: the call becomes a pending action a person approves or rejects;
 * - `disallow`: the tool is not shown to the bot's Agents at all.
 */
export type ConnectorPermission = "allow" | "ask" | "disallow"

export const CONNECTOR_PERMISSIONS: readonly ConnectorPermission[] = ["allow", "ask", "disallow"]

/** One labelled value of a preview. */
export interface ConnectorPreviewField {
  readonly label: string
  readonly value: string
}

/**
 * What a person sees before deciding, generated mechanically from the call's
 * arguments by the tool (never written by the bot), fixed when the action is created.
 */
export interface ConnectorPreview {
  /** One line, e.g. "Send this email?". */
  readonly title: string
  readonly fields: readonly ConnectorPreviewField[]
  /** Longer text shown after the fields (a message body). */
  readonly body?: string
}

/**
 * A bot's permission of one tool: the tool's default, the bot's override, and
 * the one in force. For a connector with connections, `accounts` gives the
 * bot's permission of the tool for each of its accounts: an account's own
 * override, else the tool's.
 */
export interface ConnectorToolPermission {
  readonly connectorId: string
  readonly tool: string
  readonly default: ConnectorPermission
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
  readonly accounts?: readonly ConnectorAccountPermission[]
}

/** A bot's permission of one tool when it acts as one of its accounts. */
export interface ConnectorAccountPermission {
  readonly connectionId: string
  readonly override?: ConnectorPermission
  readonly effective: ConnectorPermission
}

/**
 * A change of a bot's permission of one tool; `null` drops the override.
 * With `connectionId`, the override of that account only.
 */
export interface ConnectorPermissionChange {
  readonly connectorId: string
  readonly tool: string
  readonly permission: ConnectorPermission | null
  readonly connectionId?: string
}

export type ConnectorDecision = "approve" | "reject"

/**
 * Where a decision came from, as bot-core recorded it after checking that the
 * person may decide for the bot: only its owner can.
 */
export type ConnectorDecisionOrigin =
  /** DSH's Web UI, whose signed-in user is the owner of the DSH Host and of every bot. */
  | { readonly kind: "web" }
  /**
   * A channel of the bot (its buttons): the channel's id of the person, who is
   * one of the approvers the bot's settings of that channel name.
   */
  | {
      readonly kind: "channel"
      readonly channelId: string
      /** The channel's name when the person decided. */
      readonly channelName: string
      readonly person: string
    }

export interface ConnectorDecisionRecord {
  readonly decision: ConnectorDecision
  readonly origin: ConnectorDecisionOrigin
  readonly at: number
}

/**
 * The lifecycle of an action:
 * pending → approved → executing → succeeded | failed | interrupted,
 * approved → failed (its connector did not come back before the action's
 * expiry), and pending → rejected | expired | cancelled. `interrupted`: the Host stopped
 * while the tool ran, so whether it took effect is unknown (it is never run again).
 */
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

/** States an action never leaves. */
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

/** An action's state with what that state carries. */
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
      /** The result's data (`null` when it had none). Images are never kept. */
      readonly result: ConnectorJson
      /** The result's text, when it had one. */
      readonly text?: string
    }
  | {
      readonly state: "failed"
      readonly decision: ConnectorDecisionRecord
      /** Absent: it failed before it started (its connector never came back). */
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

/** One action of a bot's ledger: a call of an `ask` tool, fixed when the bot made it. */
export interface ConnectorAction {
  readonly id: string
  readonly botId: string
  readonly connectorId: string
  readonly tool: string
  /** The call's arguments; an approved action runs with exactly these. */
  readonly args: ConnectorJson
  readonly preview: ConnectorPreview
  /** What the tool's `snapshot` read when the action was created, if it has one. */
  readonly snapshot?: ConnectorJson
  /** The account the call acts as (a connector with connections): an approved action runs as this one. */
  readonly connectionId?: string
  /** The session whose Agent made the call. */
  readonly sessionId: string
  readonly createdAt: number
  /** When a pending action expires. */
  readonly expiresAt: number
  readonly status: ConnectorActionStatus
}

/** An action changed (created, decided, ran, ended), as the ledger publishes it. */
export interface ConnectorActionChange {
  readonly botId: string
  readonly action: ConnectorAction
}

export const CONNECTOR_DECISIONS: readonly ConnectorDecision[] = ["approve", "reject"]

/** States in which a person can still decide an action. */
export function isDecidable(state: ConnectorActionState): boolean {
  return state === "pending"
}

/** An action as the people who decide it see it: the ledger's record with its connector's name. */
export interface ConnectorActionView {
  readonly id: string
  readonly botId: string
  readonly connector: {
    readonly id: string
    /** Absent while the connector is not registered. */
    readonly name?: string
  }
  /** The tool's name in its connector. */
  readonly tool: string
  /** Its name among the bot's tools (`<connector>_<tool>`). */
  readonly toolName: string
  /** The arguments an approved action runs with (the preview shows them for people). */
  readonly args: ConnectorJson
  readonly preview: ConnectorPreview
  readonly createdAt: number
  readonly expiresAt: number
  readonly status: ConnectorActionStatus
}

/**
 * Why a decision was not taken:
 * - `not-approver`: the person may not decide for this bot;
 * - `not-found`: the bot has no such action (any more);
 * - `settled`: it was decided, cancelled or expired before (its current view is given);
 * - `closed`: the surface the decision came through is closing.
 */
export type ConnectorDecisionRefusal = "not-approver" | "not-found" | "settled" | "closed"

export type ConnectorDecisionResult =
  | { readonly accepted: true; readonly action: ConnectorActionView }
  | { readonly accepted: false; readonly reason: "settled"; readonly action: ConnectorActionView }
  | { readonly accepted: false; readonly reason: Exclude<ConnectorDecisionRefusal, "settled"> }

/** What the `botConnectorActions` Remote's `watch` streams for one bot. */
export interface BotConnectorActionsSnapshot {
  readonly botId: string
  /** Every action the ledger keeps for the bot, oldest first. */
  readonly actions: readonly ConnectorActionView[]
}

/** What the `botConnectorActions` Remote's `watchWaiting` streams: pending actions per bot. */
export interface ConnectorWaitingSnapshot {
  /** Bots with at least one pending action, by id. */
  readonly waiting: Readonly<Record<string, number>>
}

/**
 * The `botConnectorActions` Remote: the actions waiting for the owner's
 * decision and their outcome. Only the owner of the DSH Host may call it.
 */
export interface BotConnectorActionsApi {
  /** The bot's actions, again after every change of one of them. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorActionsSnapshot>
  /** How many actions wait in each bot, again after every change. */
  watchWaiting(signal?: AbortSignal): AsyncIterable<ConnectorWaitingSnapshot>
  /** The owner's decision on one pending action, made in the Web UI. */
  decide(
    botId: string,
    actionId: string,
    decision: ConnectorDecision,
  ): Promise<ConnectorDecisionResult>
}

/** The name a connector's tool has among a bot's tools. */
export function connectorToolName(connectorId: string, tool: string): string {
  return `${connectorId}_${tool}`
}

/**
 * Which of a bot's sessions see and call a connector's tools:
 * - `main`: the bot's Main session only (where its channels and notices are);
 * - `bot`: every session of the bot, subagents included.
 */
export type ConnectorSessions = "main" | "bot"

export const CONNECTOR_SESSIONS: readonly ConnectorSessions[] = ["main", "bot"]

/** Text a connector shows people; English is required. */
export interface ConnectorText {
  readonly en: string
  readonly ja?: string
}

interface SettingFieldBase<K extends string> {
  /** Stable key: lower-case camelCase letters and digits. */
  readonly key: K
  readonly label: ConnectorText
  readonly description?: ConnectorText
}

/** On or off. */
export interface ConnectorToggleField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "toggle"
  readonly default: boolean
}

/** One of a fixed set of values. */
export interface ConnectorChoiceField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "choice"
  readonly options: readonly { readonly value: string; readonly label: ConnectorText }[]
  readonly default: string
}

/** An integer within bounds. */
export interface ConnectorIntegerField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "integer"
  readonly min: number
  readonly max: number
  readonly default: number
}

/** One line of text, trimmed. */
export interface ConnectorTextField<K extends string = string> extends SettingFieldBase<K> {
  readonly kind: "text"
  readonly maxLength: number
  /** Whole-value regular expression (anchors implied); an empty value always passes. */
  readonly pattern?: string
  readonly default: string
}

/**
 * One field of a connector's per-bot settings. Secrets are no setting: a
 * connector that needs one keeps it on the Host (a connection's credentials).
 */
export type ConnectorSettingField =
  | ConnectorToggleField
  | ConnectorChoiceField
  | ConnectorIntegerField
  | ConnectorTextField

/** A bot's values of a connector's settings, by key, every field present. */
export type ConnectorSettingValues = Readonly<Record<string, string | number | boolean>>

/**
 * One save of a bot's settings of a connector: whether it is on, every
 * field's value, and how the bot gets its events (a connector with events only).
 */
export interface BotConnectorChange {
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  readonly events?: ConnectorEventDelivery
}

/**
 * Where a connector's preparation for a bot stands, each stage with the time it began:
 * - `requirements`: connectors it requires (by name) are being prepared for the bot;
 * - `queued`: another preparation of the bot runs first;
 * - `running`: its `prepare` runs, at the `step` it last reported.
 */
export type ConnectorPreparationStage =
  | {
      readonly kind: "requirements"
      readonly connectors: readonly string[]
      readonly since: number
    }
  | { readonly kind: "queued"; readonly since: number }
  | {
      readonly kind: "running"
      /** As the connector reported it (English). */
      readonly step?: string
      readonly since: number
    }

export const CONNECTOR_PREPARATION_STAGES = [
  "requirements",
  "queued",
  "running",
] as const satisfies readonly ConnectorPreparationStage["kind"][]

/**
 * Whether a connector can serve a bot right now:
 * - `disabled`: not enabled for the bot (its tools are not shown);
 * - `unavailable`: enabled, but something it needs is not there, by `cause`:
 *   the bot's account (`accounts`), the bot's environment (`environment`),
 *   or a connector it requires (`requirements`: off, missing, waiting or failed);
 * - `preparing`: being made ready since `since`, now at `stage`;
 * - `ready`: its tools run;
 * - `failed`: its preparation failed; it is tried again at `retryAt`.
 */
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

/** One tool of a connector as the browser lists it. */
export interface ConnectorToolDescriptor {
  /** The tool's name in its connector. */
  readonly name: string
  /** Its name among the bot's tools (`<connector>_<tool>`). */
  readonly toolName: string
  readonly description: string
  /** The permission of a bot that does not override it. */
  readonly permission: ConnectorPermission
}

/** The accounts a connector acts as: its provider's connections, and the scopes it needs of them. */
export interface ConnectorConnectionsDescriptor {
  readonly provider: string
  readonly scopes: readonly string[]
}

/** One kind of event a connector reports. */
export interface ConnectorEventKind {
  readonly kind: string
  readonly label: ConnectorText
}

/** The events a connector reports, and how it suggests a bot gets them. */
export interface ConnectorEventsDescriptor {
  readonly kinds: readonly ConnectorEventKind[]
  readonly delivery: Exclude<ConnectorEventDelivery, "off">
  readonly intervalMs: number
}

/** The glyphs bot-core draws for a connector's panel in the shell's menu bar. */
export const CONNECTOR_PANEL_ICONS = ["desktop", "browser", "mail", "calendar", "files"] as const

export type ConnectorPanelIcon = (typeof CONNECTOR_PANEL_ICONS)[number]

export function isConnectorPanelIcon(value: unknown): value is ConnectorPanelIcon {
  return (CONNECTOR_PANEL_ICONS as readonly unknown[]).includes(value)
}

/**
 * Where the shell shows a connector's panel: `side` in the side panel frame
 * beside the chat (Files, Actions); `popover` a large popover over the app,
 * as the settings screens, as large as its body, for a body of a fixed aspect
 * (a screen).
 */
export const CONNECTOR_PANEL_PRESENTATIONS = ["side", "popover"] as const

export type ConnectorPanelPresentation = (typeof CONNECTOR_PANEL_PRESENTATIONS)[number]

export function isConnectorPanelPresentation(value: unknown): value is ConnectorPanelPresentation {
  return (CONNECTOR_PANEL_PRESENTATIONS as readonly unknown[]).includes(value)
}

/** A connector's panel in a bot's shell, as the browser shows it. */
export interface ConnectorPanelDescriptor {
  /** The panel's title and its menu bar button's label. */
  readonly title: ConnectorText
  /** Its menu bar button's glyph. */
  readonly icon: ConnectorPanelIcon
  readonly presentation: ConnectorPanelPresentation
  /** The streams the panel's browser part may open (`botConnectorStreams.open`). */
  readonly streams: readonly string[]
}

/** The bot asks a person to act through the connector's panel (take over a desktop to log in). */
export interface ConnectorRequest {
  /** Changes with every new request. */
  readonly id: string
  /** The bot's words: untrusted, shown as text only. */
  readonly reason: string
  readonly since: number
}

/** What a connector says about itself for one bot, beside its readiness. */
export interface ConnectorStatus {
  /** One line about the connector now ("You are operating the desktop"). */
  readonly note?: ConnectorText
  /** Open until the connector clears it. */
  readonly request?: ConnectorRequest
  /**
   * A person operates what the connector shows (its screen) right now: the
   * tools of connectors that require it, except reading ones, fail meanwhile.
   */
  readonly operatedBy?: "person"
}

/** A connector's preparation of a bot's environment, as the browser shows it. */
export interface ConnectorPreparationDescriptor {
  /** What the connector says while it prepares (how long a first preparation takes). */
  readonly hint?: ConnectorText
}

/**
 * The options of the New bot dialog that turn connectors on. A connector
 * belongs to at most one; `workstation` is the desktop and browser of the
 * bot's VM.
 */
export const BOT_CREATION_OPTIONS = ["workstation"] as const

export type BotCreationOption = (typeof BOT_CREATION_OPTIONS)[number]

export function isBotCreationOption(value: unknown): value is BotCreationOption {
  return (BOT_CREATION_OPTIONS as readonly unknown[]).includes(value)
}

/** What the browser needs to show a connector: no plugin methods. */
export interface ConnectorDescriptor {
  readonly id: string
  readonly name: string
  readonly description?: ConnectorText
  readonly sessions: ConnectorSessions
  readonly settings: readonly ConnectorSettingField[]
  /** What it needs of the bot's environment (`BotConnector.minimumSpec`); empty when nothing. */
  readonly minimumSpec: BotEnvironmentMinimum
  /** The ids of the connectors it requires (`BotConnector.requires`). */
  readonly requires: readonly string[]
  /** Absent for a connector that does not prepare the bot's environment. */
  readonly preparation?: ConnectorPreparationDescriptor
  readonly tools: readonly ConnectorToolDescriptor[]
  /** Absent for a connector with no panel. */
  readonly panel?: ConnectorPanelDescriptor
  readonly connections?: ConnectorConnectionsDescriptor
  readonly events?: ConnectorEventsDescriptor
}

/** A registered connector as the rule of requirements sees it for one bot. */
export interface ConnectorSwitchSubject {
  readonly id: string
  readonly name: string
  readonly requires: readonly string[]
  readonly minimumSpec: BotEnvironmentMinimum
  readonly enabled: boolean
}

/**
 * Why a bot's connector may not be turned on or off now:
 * - `requirements-missing`: it requires connectors that are not registered (their ids);
 * - `requirements-off`: it requires connectors that are off for the bot (their names): turn them on first;
 * - `required`: connectors that require it are on for the bot (their names): turn them off first;
 * - `spec`: the bot's environment has less of `key` than the `need` of it: raise it first;
 * - `spec-unread`: it needs something of the bot's environment, whose spec is not read yet.
 */
export type ConnectorSwitchBlock =
  | { readonly kind: "requirements-missing"; readonly connectors: readonly string[] }
  | { readonly kind: "requirements-off"; readonly connectors: readonly string[] }
  | { readonly kind: "required"; readonly connectors: readonly string[] }
  | { readonly kind: "spec"; readonly key: BotEnvironmentSpecKey; readonly need: number }
  | { readonly kind: "spec-unread" }

/**
 * Whether `connector` may be switched to `enabled` for a bot whose registered
 * connectors are `registered` and whose environment has `spec`: a connector
 * is turned on only after every connector it requires and while the spec
 * gives it its `minimumSpec`, and off only after every connector requiring it.
 * Keeping its current state is never blocked, so a bot stored with a
 * connector on and one it requires off can still turn either on or the first off.
 */
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

/** Why the Host refuses to switch the connector named `name` (English). */
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

/** One account of the bot's, as a connector with connections sees it. */
export interface BotConnectorAccount {
  readonly connectionId: string
  readonly label: string
  readonly email?: string
  readonly status: ConnectionStatus
  /** The account granted the connector's scopes. */
  readonly granted: boolean
}

/** How the bot gets the connector's events, and how many wait. */
export interface BotConnectorEventsView {
  readonly delivery: ConnectorEventDelivery
  /** Events neither told nor acknowledged yet. */
  readonly waiting: number
}

/** A bot's state of one registered connector. */
export interface BotConnectorView {
  readonly connector: ConnectorDescriptor
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  readonly readiness: ConnectorReadiness
  readonly permissions: readonly ConnectorToolPermission[]
  /** The accounts assigned to the bot (a connector with connections). */
  readonly accounts?: readonly BotConnectorAccount[]
  /** A connector with events. */
  readonly events?: BotConnectorEventsView
  /** Empty while the connector is not enabled for the bot or says nothing. */
  readonly status: ConnectorStatus
}

/** What the `botConnectors` Remote's `watch` streams for one bot. */
export interface BotConnectorsSnapshot {
  readonly botId: string
  /** Every registered connector, in registration order. */
  readonly connectors: readonly BotConnectorView[]
  /** The bot's environment spec its connectors are checked against; absent until it is read. */
  readonly spec?: BotEnvironmentSpec
}

/** The `botConnectors` Remote: each bot's connectors, their settings, readiness and permissions. */
export interface BotConnectorsApi {
  /** The bot's state of every registered connector, again after every change. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorsSnapshot>
  /** Enable or disable a connector for the bot and save its settings (checked against its fields). */
  configure(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView>
  /** Override (or, with `null`, reset) the bot's permission of one tool. */
  setPermission(botId: string, change: ConnectorPermissionChange): Promise<BotConnectorView>
  /** Prepare a failed connector again now instead of at its next retry. */
  retry(botId: string, connectorId: string): Promise<BotConnectorView>
}

/**
 * The `botConnectorStreams` Remote: the streams a connector's panel opens
 * for a person (a desktop's screen). Only the owner of the DSH Host may open
 * one, only while the connector is ready for the bot; it ends when the
 * connector leaves `ready` for the bot.
 */
export interface BotConnectorStreamsApi {
  /** Items the connector yields; the browser sends items back on the uplink (JSON). */
  open(
    botId: string,
    connectorId: string,
    stream: string,
    signal?: AbortSignal,
  ): AsyncIterable<ConnectorJson>
}

/** Most streams open at once per bot and connector. */
export const MAX_CONNECTOR_STREAMS = 8

const SETTING_KEY = /^[a-z][a-zA-Z0-9]*$/
/** Upper bound of a text setting's length. */
export const MAX_CONNECTOR_TEXT_SETTING = 4096
/** Upper bound of a choice setting's options. */
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

/** Why a connector's settings fields cannot be used, or undefined. */
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
    const problem = fieldProblem(field, what)
    if (problem !== undefined) return problem
  }
  return undefined
}

/** Why a value does not fit a settings field. */
export type ConnectorSettingIssue =
  | { readonly kind: "type" }
  | { readonly kind: "choice" }
  | { readonly kind: "range"; readonly min: number; readonly max: number }
  | { readonly kind: "length"; readonly max: number }
  | { readonly kind: "format" }

/** A value checked against its field: the value stored (text trimmed), or why it does not fit. */
export type ConnectorSettingCheck =
  | { readonly ok: true; readonly value: string | number | boolean }
  | { readonly ok: false; readonly issue: ConnectorSettingIssue }

const fits = (value: string | number | boolean): ConnectorSettingCheck => ({ ok: true, value })
const misfit = (issue: ConnectorSettingIssue): ConnectorSettingCheck => ({ ok: false, issue })

/** Check one value against its field, as the Host does before storing it. */
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

/** Every field's default. */
export function defaultConnectorSettings(
  fields: readonly ConnectorSettingField[],
): ConnectorSettingValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.default]))
}

/**
 * Stored values over the defaults: a field declared later reads its default,
 * an undeclared or no longer valid value is dropped.
 */
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

/** What a change is checked against: the connector's fields, and whether it reports events. */
export interface ConnectorChangeShape {
  readonly settings: readonly ConnectorSettingField[]
  readonly events: boolean
}

/**
 * Parse a change from outside (the browser) against a connector's fields:
 * `enabled`, every field's value, and the events' delivery exactly when the
 * connector reports events; nothing else.
 * @throws naming the first problem.
 */
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
