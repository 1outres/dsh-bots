/**
 * bot-core's own seam between its rows (`files`, `channel`, `connectors`,
 * `schedule`, `web`, `prompt`, `notes`, `skills`, `conversations`: src/plugins/*.ts, built as separate entries) and the `bot` service. Not re-exported from the
 * package entry, and not part of the `Bot` contract: each method sits under a
 * symbol, and what it takes is accepted only with the token bot-core sealed
 * into the bot's currently registered preset revision (a per-load secret), so
 * other Host code cannot hand bot-core a file system for a bot or act as a
 * bot's Agent.
 */
import type { BotChannelStatus } from "./shared/channels"
import type { ConnectorReadiness } from "./shared/connectors"
import type { BotWebStatus } from "./shared/web"

/** Key of the `bot` service's attach method (registered, so both built entries share it). */
export const ATTACH_ENVIRONMENT_SERVICES: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#attachEnvironmentServices",
) as never

/**
 * The environment services a bot's preset group holds. Each getter returns the
 * service of that group's own isolated realm, or undefined; never a Host one.
 */
export interface BotEnvironmentServices {
  fs(): object | undefined
  subprocess(): object | undefined
}

/** The `bot` service's method under {@link ATTACH_ENVIRONMENT_SERVICES}. */
export type AttachEnvironmentServices = (
  botId: string,
  token: string,
  services: BotEnvironmentServices,
) => () => void

/** Key of the `bot` service's method that takes a bot's compaction (src/plugins/compaction.ts). */
export const ATTACH_COMPACTION: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#attachCompaction",
) as never

/** `compactNow` of the compaction realm a bot's preset revision holds. */
export interface BotCompactor {
  /**
   * Compact the idle Agent's history (DSH's `compactNow`); resolves to
   * whether anything was compacted. Rejects with DSH's `ManualCompactionError`.
   */
  compactNow(agent: object, signal: AbortSignal): Promise<boolean>
}

/** The `bot` service's method under {@link ATTACH_COMPACTION}. */
export type AttachCompaction = (botId: string, token: string, compactor: BotCompactor) => () => void

/** Key of the `bot` service's `stay_silent` method (src/plugins/channel.ts). */
export const STAY_CHANNEL_SILENT: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#stayChannelSilent",
) as never

/** One `stay_silent` call of a bot's Agent. */
export interface ChannelSilenceRequest {
  readonly agentId: string
}

/** The Main session's turn whose remaining replies stay off the channels. */
export interface ChannelSilenceResult {
  readonly turn: number
}

/** The `bot` service's method under {@link STAY_CHANNEL_SILENT}; throws the reason the turn was not silenced. */
export type StayChannelSilent = (
  botId: string,
  token: string,
  request: ChannelSilenceRequest,
) => ChannelSilenceResult

/** Key of the `bot` service's method that tells the connectors row its tools (src/plugins/connectors.ts). */
export const WATCH_CONNECTOR_TOOLS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#watchConnectorTools",
) as never

/** One tool the connectors row registers; `parameters` is the JSON Schema of its arguments. */
export interface ConnectorToolDescription {
  readonly name: string
  readonly description: string
  readonly parameters: object
}

/** The `bot` service's method under {@link WATCH_CONNECTOR_TOOLS}: the current tools now, then every change. */
export type WatchConnectorTools = (
  botId: string,
  token: string,
  listener: (tools: readonly ConnectorToolDescription[]) => void,
) => () => void

/** Key of the `bot` service's method that tells whether an Agent sees a connector tool. */
export const CONNECTOR_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#connectorToolAvailable",
) as never

/** The `bot` service's method under {@link CONNECTOR_TOOL_AVAILABLE}. */
export type ConnectorToolAvailable = (
  botId: string,
  token: string,
  agentId: string,
  name: string,
) => boolean

/** Key of the `bot` service's method that runs one connector tool call. */
export const CALL_CONNECTOR_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callConnectorTool",
) as never

/** One call of a connector tool (or of connector_pending_*) by a bot's Agent. */
export interface ConnectorToolRequest {
  readonly agentId: string
  readonly name: string
  readonly args: unknown
}

/** What the model reads, the same as data, and stored images (dsh-attachment references). */
export interface ConnectorToolResponse {
  readonly text: string
  readonly data: unknown
  readonly images?: readonly object[]
}

/** The `bot` service's method under {@link CALL_CONNECTOR_TOOL}; rejects with the reason a call cannot be made. */
export type CallConnectorTool = (
  botId: string,
  token: string,
  request: ConnectorToolRequest,
  signal: AbortSignal,
) => Promise<ConnectorToolResponse>
/** The schedule row's tools (src/plugins/schedule.ts). */
export type ScheduleToolName = "schedule" | "schedule_result"

/** Key of the `bot` service's method that tells whether an Agent sees a schedule tool. */
export const SCHEDULE_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#scheduleToolAvailable",
) as never

/** The `bot` service's method under {@link SCHEDULE_TOOL_AVAILABLE}. */
export type ScheduleToolAvailable = (
  botId: string,
  token: string,
  agentId: string,
  tool: ScheduleToolName,
) => boolean

/** Key of the `bot` service's method that runs one schedule tool call. */
export const CALL_SCHEDULE_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callScheduleTool",
) as never

/** One call of `schedule` or `schedule_result` by a bot's Agent. */
export interface ScheduleToolRequest {
  readonly agentId: string
  readonly tool: ScheduleToolName
  readonly args: unknown
}

/** What the model reads, and the same as data. */
export interface ScheduleToolResponse {
  readonly text: string
  readonly data: unknown
}

/** The `bot` service's method under {@link CALL_SCHEDULE_TOOL}; rejects with the reason the call failed. */
export type CallScheduleTool = (
  botId: string,
  token: string,
  request: ScheduleToolRequest,
) => Promise<ScheduleToolResponse>

/** The managed sessions row's tools (src/plugins/sessions.ts). */
export const SESSION_TOOL_NAMES = [
  "session_start",
  "session_send",
  "session_read",
  "session_answer",
  "session_stop",
  "session_list",
  "session_release",
] as const

export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number]

/** Key of the `bot` service's method that tells whether an Agent sees the session tools. */
export const SESSION_TOOLS_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#sessionToolsAvailable",
) as never

/** The `bot` service's method under {@link SESSION_TOOLS_AVAILABLE}. */
export type SessionToolsAvailable = (botId: string, token: string, agentId: string) => boolean

/** Key of the `bot` service's method that runs one session tool call. */
export const CALL_SESSION_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callSessionTool",
) as never

/** One call of a session tool by a bot's Agent. */
export interface SessionToolRequest {
  readonly agentId: string
  readonly tool: SessionToolName
  readonly args: unknown
}

/** What the model reads, and the same as data. */
export interface SessionToolResponse {
  readonly text: string
  readonly data: unknown
}

/** The `bot` service's method under {@link CALL_SESSION_TOOL}; rejects with the reason the call failed. */
export type CallSessionTool = (
  botId: string,
  token: string,
  request: SessionToolRequest,
) => Promise<SessionToolResponse>

/** Key of the `bot` service's method that tells the web bridge row whether a capability is ready (src/plugins/web.ts). */
export const WEB_READY: unique symbol = Symbol.for("@1outres/dsh-bot-core#webReady") as never

/** The `bot` service's method under {@link WEB_READY}: reads the backend's secrets, never the network. */
export type WebReady = (
  botId: string,
  token: string,
  capability: "search" | "fetch",
) => Promise<boolean>

/** Key of the `bot` service's method that runs one search of a bot's Agent. */
export const WEB_SEARCH: unique symbol = Symbol.for("@1outres/dsh-bot-core#webSearch") as never

/** Key of the `bot` service's method that runs one fetch of a bot's Agent. */
export const WEB_FETCH: unique symbol = Symbol.for("@1outres/dsh-bot-core#webFetch") as never

/** Why bot-core did not run a web operation; the row throws it as a `WebError` with this code. */
export interface WebRefusal {
  readonly code: "WEB_PROVIDER_UNAVAILABLE" | "WEB_PROVIDER_CREDENTIAL_MISSING"
  readonly message: string
}

export type WebOutcome<Result> =
  | { readonly ok: true; readonly result: Result }
  | { readonly ok: false; readonly refusal: WebRefusal }

/** The `bot` service's method under {@link WEB_SEARCH} or {@link WEB_FETCH}; a backend's own `WebError` rejects. */
export type WebOperation<Request, Result> = (
  botId: string,
  token: string,
  request: Request,
  signal: AbortSignal,
) => Promise<WebOutcome<Result>>

/** Key of the `bot` service's method that tells the prompt row what to say to an Agent (src/plugins/prompt.ts). */
export const DESCRIBE_PROMPT: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#describePrompt",
) as never

/**
 * Which session of its bot an Agent runs, fixed when the session is created:
 * the Main session, a session opened in the Web UI (New session, a fork), a
 * session the Main session started (`session_start`), the own session of a
 * `separate` schedule run, a subagent of any of them, or the bot's hidden
 * session that curates its skills (docs/specs/bot-skills.md §12).
 */
export type BotSessionKind = "main" | "web" | "delegated" | "schedule" | "subagent" | "curator"

/** A chat channel the bot's settings turn on, with how to write for it. */
export interface BotPromptChannel {
  readonly name: string
  /** One line on the channel's formatting (BotChannel.formatHint), absent when it gives none. */
  readonly formatHint?: string
}

/** One chat channel the bot's settings turn on, as the bot's status tells it. */
export interface BotStatusChannel {
  readonly name: string
  readonly status: BotChannelStatus
  /** The channel's ids of the people its settings list as the bot's owners there. */
  readonly owners: readonly string[]
}

/** One connector enabled for the bot. */
export interface BotStatusConnector {
  readonly name: string
  readonly readiness: ConnectorReadiness
  /** Its usable accounts (email, else label), for a connector with connections. */
  readonly accounts: readonly string[]
}

/** The facts the `bot:status` context reports; they change during a session. */
export interface BotStatusFacts {
  readonly channels: readonly BotStatusChannel[]
  readonly connectors: readonly BotStatusConnector[]
  readonly web: BotWebStatus
}

/** How the Main session manages the Agent's session right now, if it does. */
export interface BotManagementFacts {
  readonly answerer: "main" | "owner"
}

/** Everything the prompt row says to one Agent of the bot. */
export interface BotPromptFacts {
  readonly botName: string
  readonly session: BotSessionKind
  /** Absent while the session is not managed (and always for the Main session and subagents). */
  readonly management?: BotManagementFacts
  readonly channels: readonly BotPromptChannel[]
  readonly status: BotStatusFacts
}

/** The `bot` service's method under {@link DESCRIBE_PROMPT}; throws when the Agent is not one of the bot's. */
export type DescribePrompt = (botId: string, token: string, agentId: string) => BotPromptFacts

/** The notes row's tools (src/plugins/notes.ts). */
export type NoteToolName = "note_read" | "note_write" | "note_link" | "note_search"

/** Key of the `bot` service's method that runs one note tool call. */
export const CALL_NOTE_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callNoteTool",
) as never

/** One call of a note tool by a bot's Agent. */
export interface NoteToolRequest {
  readonly agentId: string
  readonly tool: NoteToolName
  readonly args: unknown
}

/** What the model reads. */
export interface NoteToolResponse {
  readonly text: string
}

/** The `bot` service's method under {@link CALL_NOTE_TOOL}; rejects with the reason the call failed. */
export type CallNoteTool = (
  botId: string,
  token: string,
  request: NoteToolRequest,
  signal: AbortSignal,
) => Promise<NoteToolResponse>

/** Key of the `bot` service's method the notes row calls before each step of a bot's Agent. */
export const PREPARE_NOTES: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#prepareNotes",
) as never

/** A message a step takes in: whether a person sent it (source `user`) and its text. */
export interface NoteStepMessage {
  readonly fromUser: boolean
  readonly text: string
}

export interface NoteStepRequest {
  readonly agentId: string
  readonly messages: readonly NoteStepMessage[]
}

/** The notice of the notes an owner's message names, added after it (docs/specs/bot-notes.md §5). */
export interface NoteMentionNotice {
  readonly text: string
  /** One line, at most 120 characters. */
  readonly summary: string
}

/**
 * The `bot` service's method under {@link PREPARE_NOTES}: brings the bot's
 * notes up to date from its files (the pinned notes context reads them) and
 * answers with the notice for the step's messages, if any.
 */
export type PrepareNotes = (
  botId: string,
  token: string,
  request: NoteStepRequest,
  signal: AbortSignal,
) => Promise<NoteMentionNotice | undefined>

/** Key of the `bot` service's method that gives the pinned notes context of an Agent. */
export const PINNED_NOTES: unique symbol = Symbol.for("@1outres/dsh-bot-core#pinnedNotes") as never

/** The `bot` service's method under {@link PINNED_NOTES}; throws when the Agent is not one of the bot's. */
export type PinnedNotes = (botId: string, token: string, agentId: string) => string

/** Key of the `bot` service's method that tells whether an Agent sees skill_manage (src/plugins/skills.ts). */
export const SKILL_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#skillToolAvailable",
) as never

/** The `bot` service's method under {@link SKILL_TOOL_AVAILABLE}. */
export type SkillToolAvailable = (botId: string, token: string, agentId: string) => boolean

/** Key of the `bot` service's method that runs one skill_manage call. */
export const CALL_SKILL_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callSkillTool",
) as never

/** One skill_manage call by a bot's Agent. */
export interface SkillToolRequest {
  readonly agentId: string
  readonly args: unknown
}

/** The `bot` service's method under {@link CALL_SKILL_TOOL}; rejects with the reason nothing was changed. */
export type CallSkillTool = (
  botId: string,
  token: string,
  request: SkillToolRequest,
  signal: AbortSignal,
) => Promise<{ readonly text: string }>

/** Key of the `bot` service's method the skills row calls before each step of a bot's Agent. */
export const PREPARE_SKILLS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#prepareSkills",
) as never

/**
 * The `bot` service's method under {@link PREPARE_SKILLS}: counts the step for
 * the skill review and reads the bot's skills/ again, telling the row's
 * watchers when the catalog changed. Never rejects for an environment that
 * cannot be read (the step goes on with the catalog it has).
 */
export type PrepareSkills = (
  botId: string,
  token: string,
  agentId: string,
  signal: AbortSignal,
) => Promise<void>

/** One of the bot's active skills, as the skills row's provider lists it. */
export interface BotSkillEntry {
  readonly name: string
  readonly description: string
  /** The skill's directory in the bot's environment (an absolute path there). */
  readonly directory: string
}

/** Key of the `bot` service's method that lists the bot's active skills. */
export const LIST_SKILLS: unique symbol = Symbol.for("@1outres/dsh-bot-core#listSkills") as never

/** The `bot` service's method under {@link LIST_SKILLS}; rejects when skills/ cannot be read. */
export type ListSkills = (
  botId: string,
  token: string,
  signal: AbortSignal,
) => Promise<readonly BotSkillEntry[]>

/** Key of the `bot` service's method that loads one skill (and counts the use). */
export const LOAD_SKILL: unique symbol = Symbol.for("@1outres/dsh-bot-core#loadSkill") as never

/** The `bot` service's method under {@link LOAD_SKILL}: the skill's instructions, or undefined when it is gone. */
export type LoadSkill = (
  botId: string,
  token: string,
  name: string,
  signal: AbortSignal,
) => Promise<(BotSkillEntry & { readonly content: string }) | undefined>

/** Key of the `bot` service's method that tells the skills row when the bot's skills changed. */
export const WATCH_SKILLS: unique symbol = Symbol.for("@1outres/dsh-bot-core#watchSkills") as never

/** The `bot` service's method under {@link WATCH_SKILLS}; returns the disposer. */
export type WatchSkills = (botId: string, token: string, listener: () => void) => () => void

/** The conversations row's tools (src/plugins/conversations.ts). */
export const CONVERSATION_TOOL_NAMES = ["conversation_search", "conversation_read"] as const

export type ConversationToolName = (typeof CONVERSATION_TOOL_NAMES)[number]

/** Key of the `bot` service's method that tells whether an Agent sees the conversation tools. */
export const CONVERSATION_TOOLS_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#conversationToolsAvailable",
) as never

/** The `bot` service's method under {@link CONVERSATION_TOOLS_AVAILABLE}. */
export type ConversationToolsAvailable = (botId: string, token: string, agentId: string) => boolean

/** Key of the `bot` service's method that runs one conversation tool call. */
export const CALL_CONVERSATION_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callConversationTool",
) as never

/** One call of a conversation tool by a bot's Agent. */
export interface ConversationToolRequest {
  readonly agentId: string
  readonly tool: ConversationToolName
  readonly args: unknown
}

/** What the model reads. */
export interface ConversationToolResponse {
  readonly text: string
}

/** The `bot` service's method under {@link CALL_CONVERSATION_TOOL}; rejects with the reason the call failed. */
export type CallConversationTool = (
  botId: string,
  token: string,
  request: ConversationToolRequest,
  signal: AbortSignal,
) => Promise<ConversationToolResponse>
