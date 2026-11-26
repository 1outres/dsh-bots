import type { PostToolDecision, ToolExecutionResult } from "@deepseek-ai/dsh-tools"
import type { BotChannelStatus } from "./shared/channels"
import type { ConnectorReadiness } from "./shared/connectors"
import type { BotWebStatus } from "./shared/web"

export const ATTACH_ENVIRONMENT_SERVICES: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#attachEnvironmentServices",
) as never

export interface BotEnvironmentServices {
  fs(): object | undefined
  subprocess(): object | undefined
}

export type AttachEnvironmentServices = (
  botId: string,
  token: string,
  services: BotEnvironmentServices,
) => () => void

export const ATTACH_COMPACTION: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#attachCompaction",
) as never

export interface BotCompactor {
  compactNow(agent: object, signal: AbortSignal): Promise<boolean>
}

export type AttachCompaction = (botId: string, token: string, compactor: BotCompactor) => () => void

export const STAY_CHANNEL_SILENT: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#stayChannelSilent",
) as never

export interface ChannelSilenceRequest {
  readonly agentId: string
}

export interface ChannelSilenceResult {
  readonly turn: number
}

export type StayChannelSilent = (
  botId: string,
  token: string,
  request: ChannelSilenceRequest,
) => ChannelSilenceResult

export const WATCH_CONNECTOR_TOOLS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#watchConnectorTools",
) as never

export interface ConnectorToolDescription {
  readonly name: string
  readonly description: string
  readonly parameters: object
}

export type WatchConnectorTools = (
  botId: string,
  token: string,
  listener: (tools: readonly ConnectorToolDescription[]) => void,
) => () => void

export const CONNECTOR_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#connectorToolAvailable",
) as never

export type ConnectorToolAvailable = (
  botId: string,
  token: string,
  agentId: string,
  name: string,
) => boolean

export const CALL_CONNECTOR_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callConnectorTool",
) as never

export interface ConnectorToolRequest {
  readonly agentId: string
  readonly name: string
  readonly args: unknown
}

export interface ConnectorToolResponse {
  readonly text: string
  readonly data: unknown
  readonly images?: readonly object[]
}

export type CallConnectorTool = (
  botId: string,
  token: string,
  request: ConnectorToolRequest,
  signal: AbortSignal,
) => Promise<ConnectorToolResponse>
export type ScheduleToolName = "schedule" | "schedule_result"

export const SCHEDULE_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#scheduleToolAvailable",
) as never

export type ScheduleToolAvailable = (
  botId: string,
  token: string,
  agentId: string,
  tool: ScheduleToolName,
) => boolean

export const CALL_SCHEDULE_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callScheduleTool",
) as never

export interface ScheduleToolRequest {
  readonly agentId: string
  readonly tool: ScheduleToolName
  readonly args: unknown
}

export interface ScheduleToolResponse {
  readonly text: string
  readonly data: unknown
}

export type CallScheduleTool = (
  botId: string,
  token: string,
  request: ScheduleToolRequest,
) => Promise<ScheduleToolResponse>

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

export const SESSION_TOOLS_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#sessionToolsAvailable",
) as never

export type SessionToolsAvailable = (botId: string, token: string, agentId: string) => boolean

export const CALL_SESSION_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callSessionTool",
) as never

export interface SessionToolRequest {
  readonly agentId: string
  readonly tool: SessionToolName
  readonly args: unknown
}

export interface SessionToolResponse {
  readonly text: string
  readonly data: unknown
}

export type CallSessionTool = (
  botId: string,
  token: string,
  request: SessionToolRequest,
) => Promise<SessionToolResponse>

export const PEER_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#peerToolAvailable",
) as never

export type PeerToolAvailable = (botId: string, token: string, agentId: string) => boolean

export const CALL_PEER_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callPeerTool",
) as never

export interface PeerToolRequest {
  readonly agentId: string
  readonly args: unknown
}

export interface PeerToolResponse {
  readonly text: string
  readonly data: unknown
}

export type CallPeerTool = (
  botId: string,
  token: string,
  request: PeerToolRequest,
) => Promise<PeerToolResponse>

export const WEB_READY: unique symbol = Symbol.for("@1outres/dsh-bot-core#webReady") as never

export type WebReady = (
  botId: string,
  token: string,
  capability: "search" | "fetch",
) => Promise<boolean>

export const WEB_SEARCH: unique symbol = Symbol.for("@1outres/dsh-bot-core#webSearch") as never

export const WEB_FETCH: unique symbol = Symbol.for("@1outres/dsh-bot-core#webFetch") as never

export interface WebRefusal {
  readonly code: "WEB_PROVIDER_UNAVAILABLE" | "WEB_PROVIDER_CREDENTIAL_MISSING"
  readonly message: string
}

export type WebOutcome<Result> =
  | { readonly ok: true; readonly result: Result }
  | { readonly ok: false; readonly refusal: WebRefusal }

export type WebOperation<Request, Result> = (
  botId: string,
  token: string,
  request: Request,
  signal: AbortSignal,
) => Promise<WebOutcome<Result>>

export const DESCRIBE_PROMPT: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#describePrompt",
) as never

export type BotSessionKind = "main" | "web" | "delegated" | "schedule" | "subagent" | "curator"

export interface BotPromptChannel {
  readonly name: string
  readonly formatHint?: string
}

export interface BotStatusChannel {
  readonly name: string
  readonly status: BotChannelStatus
  readonly owners: readonly string[]
}

export interface BotStatusConnector {
  readonly name: string
  readonly readiness: ConnectorReadiness
  readonly accounts: readonly string[]
}

export interface BotStatusFacts {
  readonly channels: readonly BotStatusChannel[]
  readonly connectors: readonly BotStatusConnector[]
  readonly web: BotWebStatus
}

export interface BotManagementFacts {
  readonly answerer: "main" | "owner"
}

export type BotPeerMachine = "ready" | "starting" | "stopped"

export interface BotPeerFact {
  readonly botId: string
  readonly name: string
  readonly role: string
  readonly machine: BotPeerMachine
  readonly pausedUntil?: number
}

export interface BotPeerFacts {
  readonly group: string
  readonly purpose: string
  readonly role: string
  readonly paused?: "owner" | "limit"
  readonly peers: readonly BotPeerFact[]
  readonly timezone: string
}

export interface BotPromptFacts {
  readonly botName: string
  readonly session: BotSessionKind
  readonly management?: BotManagementFacts
  readonly peers?: BotPeerFacts
  readonly channels: readonly BotPromptChannel[]
  readonly logins: boolean
  readonly status: BotStatusFacts
}

export type DescribePrompt = (botId: string, token: string, agentId: string) => BotPromptFacts

export type NoteToolName = "note_read" | "note_write" | "note_link" | "note_search"

export const CALL_NOTE_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callNoteTool",
) as never

export interface NoteToolRequest {
  readonly agentId: string
  readonly tool: NoteToolName
  readonly args: unknown
}

export interface NoteToolResponse {
  readonly text: string
}

export type CallNoteTool = (
  botId: string,
  token: string,
  request: NoteToolRequest,
  signal: AbortSignal,
) => Promise<NoteToolResponse>

export const PREPARE_NOTES: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#prepareNotes",
) as never

export interface NoteStepMessage {
  readonly fromUser: boolean
  readonly text: string
}

export interface NoteStepRequest {
  readonly agentId: string
  readonly messages: readonly NoteStepMessage[]
}

export interface NoteMentionNotice {
  readonly text: string
  readonly summary: string
}

export type PrepareNotes = (
  botId: string,
  token: string,
  request: NoteStepRequest,
  signal: AbortSignal,
) => Promise<NoteMentionNotice | undefined>

export const PINNED_NOTES: unique symbol = Symbol.for("@1outres/dsh-bot-core#pinnedNotes") as never

export type PinnedNotes = (botId: string, token: string, agentId: string) => string

export const SKILL_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#skillToolAvailable",
) as never

export type SkillToolAvailable = (botId: string, token: string, agentId: string) => boolean

export const CALL_SKILL_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callSkillTool",
) as never

export interface SkillToolRequest {
  readonly agentId: string
  readonly args: unknown
}

export type CallSkillTool = (
  botId: string,
  token: string,
  request: SkillToolRequest,
  signal: AbortSignal,
) => Promise<{ readonly text: string }>

export const PREPARE_SKILLS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#prepareSkills",
) as never

export type PrepareSkills = (
  botId: string,
  token: string,
  agentId: string,
  signal: AbortSignal,
) => Promise<void>

export interface BotSkillEntry {
  readonly name: string
  readonly description: string
  readonly directory: string
}

export const LIST_SKILLS: unique symbol = Symbol.for("@1outres/dsh-bot-core#listSkills") as never

export type ListSkills = (
  botId: string,
  token: string,
  signal: AbortSignal,
) => Promise<readonly BotSkillEntry[]>

export const LOAD_SKILL: unique symbol = Symbol.for("@1outres/dsh-bot-core#loadSkill") as never

export type LoadSkill = (
  botId: string,
  token: string,
  name: string,
  signal: AbortSignal,
) => Promise<(BotSkillEntry & { readonly content: string }) | undefined>

export const WATCH_SKILLS: unique symbol = Symbol.for("@1outres/dsh-bot-core#watchSkills") as never

export type WatchSkills = (botId: string, token: string, listener: () => void) => () => void

export const CONVERSATION_TOOL_NAMES = ["conversation_search", "conversation_read"] as const

export type ConversationToolName = (typeof CONVERSATION_TOOL_NAMES)[number]

export const CONVERSATION_TOOLS_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#conversationToolsAvailable",
) as never

export type ConversationToolsAvailable = (botId: string, token: string, agentId: string) => boolean

export const CALL_CONVERSATION_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callConversationTool",
) as never

export interface ConversationToolRequest {
  readonly agentId: string
  readonly tool: ConversationToolName
  readonly args: unknown
}

export interface ConversationToolResponse {
  readonly text: string
}

export type CallConversationTool = (
  botId: string,
  token: string,
  request: ConversationToolRequest,
  signal: AbortSignal,
) => Promise<ConversationToolResponse>
export const SETTINGS_TOOL_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#settingsToolAvailable",
) as never

export type SettingsToolAvailable = (botId: string, token: string, agentId: string) => boolean

export const CALL_SETTINGS_TOOL: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#callSettingsTool",
) as never

export interface SettingsToolCall {
  readonly agentId: string
  readonly args: unknown
}

export type CallSettingsTool = (
  botId: string,
  token: string,
  request: SettingsToolCall,
  signal: AbortSignal,
) => Promise<{ readonly text: string }>

export const GUARD_TOOL_ARGUMENTS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#guardToolArguments",
) as never

export interface GuardArgumentsRequest {
  readonly agentId: string
  readonly tool: string
  readonly args: unknown
}

export type GuardArgumentsVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }

export type GuardToolArguments = (
  botId: string,
  token: string,
  request: GuardArgumentsRequest,
) => Promise<GuardArgumentsVerdict>

export const GUARD_TOOL_RESULT: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#guardToolResult",
) as never

export interface GuardResultRequest {
  readonly agentId: string
  readonly tool: string
  readonly result: Readonly<ToolExecutionResult>
  readonly decision: PostToolDecision
}

export type GuardResultVerdict =
  | { readonly kind: "clean" }
  | {
      readonly kind: "withheld"
      readonly result: Readonly<ToolExecutionResult>
      readonly decision: PostToolDecision
    }
  | { readonly kind: "failed"; readonly reason: string }

export type GuardToolResult = (
  botId: string,
  token: string,
  request: GuardResultRequest,
) => Promise<GuardResultVerdict>

export const CREDENTIALS_AVAILABLE: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#credentialsAvailable",
) as never

export type CredentialsAvailable = (botId: string, token: string, agentId: string) => boolean

export const LIST_CREDENTIALS: unique symbol = Symbol.for(
  "@1outres/dsh-bot-core#listCredentials",
) as never

export type ListCredentials = (
  botId: string,
  token: string,
  agentId: string,
  signal: AbortSignal,
) => Promise<{ readonly text: string; readonly data: unknown }>
