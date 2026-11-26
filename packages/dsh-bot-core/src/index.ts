import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, scrypt } from "node:crypto"
import type { Context } from "@deepseek-ai/cordis"
import { installModelSelection } from "@deepseek-ai/dsh-agent"
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm"
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy"
import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval"
import z from "@deepseek-ai/schemastery"
import manifest from "../package.json"
import type { BotPresetChange } from "./contract"
import { createChannelCatalog } from "./host/channels/catalog"
import { createCommandRunner } from "./host/channels/commands"
import { busyModeOf, type SettingsForm } from "./host/channels/composer"
import type { ConversationDeps } from "./host/channels/conversation"
import { CHANNELS_DOMAIN, type ChannelRecord } from "./host/channels/domain"
import {
  type AssistantMessageData,
  createMainFeed,
  type SessionEventLike,
} from "./host/channels/feed"
import { createChannelHub } from "./host/channels/hub"
import { composePrompt, type ImageLimits, type PromptPart } from "./host/channels/inbound"
import { INBOX_DIRECTORY } from "./host/channels/inbox"
import {
  createShellInboxWriter,
  type EnvironmentWriteSubprocess,
} from "./host/channels/inbox-shell"
import { createChannelOutlets } from "./host/channels/outlets"
import { ownersOf } from "./host/channels/owners"
import { createChannelPanel } from "./host/channels/panel"
import { createPresentedFiles } from "./host/channels/presented"
import { createPresentedDelivery } from "./host/channels/presented-delivery"
import { createChannelSequence } from "./host/channels/sequence"
import { createChannelSettings } from "./host/channels/settings"
import { createTurnSilence, turnBoundaryOf } from "./host/channels/silence"
import { createSilencer } from "./host/channels/stay-silent"
import { type CredentialRecords, createSecretVault } from "./host/channels/vault"
import { cleanupBotSessions } from "./host/cleanup"
import { createConnectorAccounts } from "./host/connections/accounts"
import { CALLBACK_HEADERS, callbackPage } from "./host/connections/callback-page"
import { createOAuthClients } from "./host/connections/clients"
import {
  type ClientRecord,
  CONNECTIONS_DOMAIN,
  type ConnectionRecord,
  type GrantRecord,
} from "./host/connections/domain"
import type { OAuthFetch } from "./host/connections/oauth"
import { createConnectionPanel } from "./host/connections/panel"
import { createConnectionProviders } from "./host/connections/providers"
import { createConnectionServices } from "./host/connections/services"
import { createConnectionSignIn } from "./host/connections/signin"
import { connectionInfo, createConnectionStore } from "./host/connections/store"
import { createConnectionTokens } from "./host/connections/tokens"
import { type ConnectionCredentialRecords, createConnectionVault } from "./host/connections/vault"
import { createConnectorApprovals } from "./host/connectors/approvals"
import { createConnectorAttachments } from "./host/connectors/attachments"
import { type ConnectorCaller, createConnectorsBackend } from "./host/connectors/backend"
import { createConnectorBroker } from "./host/connectors/broker"
import { createConnectorCatalog } from "./host/connectors/catalog"
import { createCreationConnectors } from "./host/connectors/creation"
import { createDeadlines } from "./host/connectors/deadlines"
import {
  CONNECTORS_DOMAIN,
  type PermissionRecord,
  type SettingsRecord,
} from "./host/connectors/domain"
import { type ConnectorSubprocess, createConnectorEnvironment } from "./host/connectors/environment"
import { createExclusiveRuns } from "./host/connectors/exclusive"
import { createRunImages, type ImageServices } from "./host/connectors/images"
import { createConnectorLedger } from "./host/connectors/ledger"
import { environmentNeeds } from "./host/connectors/needs"
import { createConnectorPanel } from "./host/connectors/panel"
import { createConnectorPermissions } from "./host/connectors/permissions"
import { createConnectorReadiness, type EnvironmentState } from "./host/connectors/readiness"
import { operatedRequirement } from "./host/connectors/requirements"
import { createConnectorRuns } from "./host/connectors/runs"
import { createConnectorSettings } from "./host/connectors/settings"
import { createConnectorStatuses } from "./host/connectors/statuses"
import { createConnectorStreams } from "./host/connectors/streams"
import { createConnectorToolSurface } from "./host/connectors/tools"
import { createBotConversations } from "./host/conversations/bot-conversations"
import type { SessionLog, LoggedEvent as SessionLogEvent } from "./host/conversations/history"
import { ownerConversations } from "./host/conversations/sources"
import { createConversationTools, type SessionLogReader } from "./host/conversations/tools"
import {
  BOTS_DOMAIN,
  type BotRecord,
  type BotSessionRecord,
  INITIAL_NOTES_VERSION,
  mainOnBotPreset,
  parseOverlay,
  WORKSPACE_FILES_VERSION,
} from "./host/domain"
import { createEnvironmentKeeper } from "./host/environment"
import { createEnvironmentHostPanel } from "./host/environment-host/panel"
import {
  ENVIRONMENT_SPECS_DOMAIN,
  type EnvironmentSpecRecord,
} from "./host/environment-spec/domain"
import { createInitialSpecs } from "./host/environment-spec/initial"
import { createEnvironmentPanel } from "./host/environment-spec/panel"
import { createEnvironmentSpecStore } from "./host/environment-spec/store"
import { createEventDelivery } from "./host/events/delivery"
import { type CursorRecord, EVENTS_DOMAIN, type EventRecord } from "./host/events/domain"
import { createEventPoller } from "./host/events/poller"
import { createEventStore } from "./host/events/store"
import { createConnectorOwnTools } from "./host/events/tools"
import {
  createBotFiles,
  createEnvironmentFilesKeeper,
  DEFAULT_FILES_LIMITS,
  type EnvironmentFileSystem,
  type EnvironmentSubprocess,
} from "./host/files"
import { createApprovalAnswerer, createQuestionAnswerer } from "./host/interactions/answerers"
import { createInteractionBoard, type InteractionPlace } from "./host/interactions/board"
import { createContinuedQuestions } from "./host/interactions/continued"
import type {
  DshApprovalOutcome,
  DshApprovalRequest,
  DshPendingQuestion,
  DshQuestionAnswer,
  DshQuestionRequest,
} from "./host/interactions/dsh"
import { createInteractionPanel } from "./host/interactions/panel"
import { createBotLifecycle } from "./host/lifecycle"
import { createMainGuard, greetingText, waitForEnvironment } from "./host/main"
import { createMainView, type MainImageRef } from "./host/main-view/panel"
import { createCompactorKeeper } from "./host/mains/compactors"
import { createMainController } from "./host/mains/controller"
import {
  MAINS_DOMAIN,
  type MainActivityRecord,
  type StoredMainOverride,
  type StoredMainSettings,
} from "./host/mains/domain"
import { countCompactions, type LoggedEvent, usagePercentOf } from "./host/mains/log"
import { createMainPanel } from "./host/mains/panel"
import { createMainPreparations } from "./host/mains/preparations"
import { openMainStore } from "./host/mains/store"
import { createMaintenanceTurns } from "./host/mains/turns"
import { createTurnAuthority } from "./host/managed/authority"
import {
  MANAGED_SESSIONS_DOMAIN,
  type ManagedSessionRecord,
  type WorkspaceGrantRecord,
} from "./host/managed/domain"
import { createManagedFollow } from "./host/managed/follow"
import { createWorkspaceGrants } from "./host/managed/grants"
import { createGrantStore } from "./host/managed/grants-store"
import type { MainMessage } from "./host/managed/messages"
import { type SessionNoticeEvent, sessionNotice } from "./host/managed/notice"
import { type PermissionCatalog, workspaceOptions } from "./host/managed/options"
import { createManagedPanel } from "./host/managed/panel"
import { createManagedSessions } from "./host/managed/sessions"
import { createManagedStore } from "./host/managed/store"
import { createManagedTools } from "./host/managed/tools"
import { createManagedWaits } from "./host/managed/waits"
import { createWorkspaceSessions } from "./host/managed/workspace-session"
import { createWorkspacesPanel } from "./host/managed/workspaces-panel"
import { createModelCatalog, type LlmRegistry } from "./host/models/catalog"
import { type BotModelsRecord, MODELS_DOMAIN } from "./host/models/domain"
import { createMainModelApplier } from "./host/models/main"
import { createBotModels, type SessionModel } from "./host/models/models"
import { createModelPanel } from "./host/models/panel"
import { createBotModelStore } from "./host/models/store"
import { createBotNotes } from "./host/notes/bot-notes"
import { createMemoryFlush } from "./host/notes/flush"
import { uuidv7 } from "./host/notes/ids"
import { createInitialNotes } from "./host/notes/initial"
import type { NotesFileSystem, NotesPlace } from "./host/notes/notebook"
import { createNotesPanel } from "./host/notes/panel"
import { createNoteTools } from "./host/notes/tools"
import { createNoticeDelivery, type NoticeAgent, type NoticeMessage } from "./host/notices/delivery"
import { NOTICES_DOMAIN, type NoticeRecord } from "./host/notices/domain"
import { createNoticeOutbox } from "./host/notices/outbox"
import { createWelcomeChannels } from "./host/onboarding/channels"
import { ONBOARDING_DOMAIN, type OnboardingRecord } from "./host/onboarding/domain"
import { followWelcomeBot } from "./host/onboarding/follow"
import { createReleaseNotesKeeper } from "./host/onboarding/notes"
import { createOnboardingPanel } from "./host/onboarding/panel"
import { fetchDueNotes } from "./host/onboarding/releases"
import { releaseSourceOf } from "./host/onboarding/source"
import { openOnboardingStore } from "./host/onboarding/store"
import { acknowledging } from "./host/onboarding/welcome"
import { createBotPermissions, type PermissionPresets } from "./host/permission"
import { createSessionPreparations } from "./host/preparations"
import { createTemplateCatalog } from "./host/preset/catalog"
import { pluginNamesOf } from "./host/preset/compose"
import { defaultTemplate } from "./host/preset/default-template"
import { botOfIdentity, botOfPresetId, createSessionIdentity } from "./host/preset/identity"
import { createIsolation, type ToolEntry } from "./host/preset/isolation"
import { createPlacementKeeper } from "./host/preset/placement"
import { createPresetRealizer } from "./host/preset/realize"
import { BotPresetNotReadyError, createBotSessions } from "./host/preset/session"
import type { ComposedPreset, WebComposition } from "./host/preset/types"
import { createPromptFacts } from "./host/prompt/facts"
import { type SessionKindDeps, sessionKindOf } from "./host/prompt/session-kind"
import { type BotTable, createBotRegistry } from "./host/registry"
import {
  BotChannelsRemoteService,
  BotConnectionsRemoteService,
  BotConnectorActionsRemoteService,
  BotConnectorStreamsRemoteService,
  BotConnectorsRemoteService,
  BotEnvironmentHostRemoteService,
  BotEnvironmentRemoteService,
  BotFilesRemoteService,
  BotInteractionsRemoteService,
  BotMainsRemoteService,
  BotMainViewRemoteService,
  BotManagedSessionsRemoteService,
  BotNotesRemoteService,
  BotOnboardingRemoteService,
  BotSkillsRemoteService,
  BotsRemoteService,
  BotVaultsRemoteService,
  BotWebRemoteService,
  BotWorkspacesRemoteService,
} from "./host/remote"
import { registerRemoteContract, type TypertRegistry } from "./host/remote-contract"
import { createSaveQueue } from "./host/save-queue"
import { createCheckRunner } from "./host/schedule/check"
import { type JobRecord, type RunRecord, SCHEDULES_DOMAIN } from "./host/schedule/domain"
import { isArmed } from "./host/schedule/jobs"
import { createScheduleRunner } from "./host/schedule/runner"
import { createScheduler } from "./host/schedule/scheduler"
import { createScheduleStore } from "./host/schedule/store"
import { canonicalTimezone } from "./host/schedule/timing"
import { createScheduleTools, type ScheduleCaller } from "./host/schedule/tools"
import { createBotSkills } from "./host/skills/bot-skills"
import { createSkillCuration } from "./host/skills/curation"
import {
  type CuratorCreation,
  createCurationRunner,
  createCuratorSessions,
} from "./host/skills/curation-run"
import {
  SKILLS_DOMAIN,
  type SkillCurationRecord,
  type SkillHistoryRecord,
  type SkillMarkRecord,
  type SkillSettingsRecord,
  type SkillUsageRecord,
} from "./host/skills/domain"
import type { SkillsFileSystem, SkillsPlace } from "./host/skills/library"
import { SKILL_MANAGE_TOOL } from "./host/skills/manage"
import { createSkillPanel } from "./host/skills/panel"
import { createSkillRetentions, UNUSED_ARCHIVE_REASON } from "./host/skills/retention"
import { createReviewSessions, createSkillReviews } from "./host/skills/review"
import {
  createReviewRunner,
  type ReviewAgentRequest,
  type ReviewSeedEvent,
} from "./host/skills/review-run"
import { createSkillStore } from "./host/skills/store"
import { CURATION_REFUSAL, REVIEW_REFUSAL } from "./host/skills/texts"
import type { TranscriptMessage } from "./host/spoken-messages"
import { createVaultAccess } from "./host/vaults/access"
import { createVaultAvailability } from "./host/vaults/availability"
import { createVaultChecks } from "./host/vaults/checks"
import {
  VAULTS_DOMAIN,
  type VaultAccountRecord,
  type VaultFingerprintRecord,
  type VaultGrantRecord,
  type VaultIncidentRecord,
  type VaultUseRecord,
} from "./host/vaults/domain"
import { type GuardKeys, ROLLING_HASH_BYTES, rollingHashFrom } from "./host/vaults/fingerprints"
import { createVaultGuard, incidentView } from "./host/vaults/guard"
import { createVaultPanel } from "./host/vaults/panel"
import { createVaultProviders } from "./host/vaults/providers"
import { createVaultRecords, type GuardKeyMaterial } from "./host/vaults/records"
import { createVaultRows } from "./host/vaults/rows"
import { createVaultSessions } from "./host/vaults/sessions"
import { createVaultStore } from "./host/vaults/store"
import { createWebBridge } from "./host/web/bridge"
import { createWebBackendCatalog } from "./host/web/catalog"
import { WEB_DOMAIN, WEB_SETTINGS_KEY } from "./host/web/domain"
import { createWebPanel } from "./host/web/panel"
import { createWebState } from "./host/web/state"
import { openWebSettingsStore } from "./host/web/store"
import { createWebTester } from "./host/web/tester"
import { createWebSecretVault } from "./host/web/vault"
import { createWorkingDirectoryAccess, type EnvironmentFs } from "./host/working-directory"
import { createWorkspaceFiles, type WritableFileSystem } from "./host/workspace-files"
import type { BotEnvironmentServices, BotStatusChannel } from "./internal"
import type { MainTurnPrompt } from "./mains-contract"
import { BotService } from "./service"
import type { BotView } from "./shared/bots"
import { CONNECTION_CALLBACK_PATH, connectionName } from "./shared/connections"
import type { ConnectorAction } from "./shared/connectors"
import { sameEnvironmentSpec } from "./shared/environment"
import type { BotInteraction } from "./shared/interactions"
import { effectiveMainRotation } from "./shared/mains"
import type { BotManagedSession } from "./shared/managed-sessions"
import type { BotModelSelection } from "./shared/models"
import type { ApprovalPolicy, SandboxMode } from "./shared/permission"
import { type BotOverlay, type BotPresetState, botPresetId } from "./shared/preset"
import type { BotWebSettings } from "./shared/web"
import type { DshWorkspace } from "./shared/workspaces"

export * from "./contract"
export { BOT_COMMANDS } from "./host/channels/capabilities"
export { DEFAULT_FILES_LIMITS } from "./host/files"
export { REMOTE_SERVICES } from "./host/remote"
export { HOST_REMOTE_CONTRIBUTION } from "./host/remote-contract"
export { BotService } from "./service"
export type * from "./shared/bots"
export type * from "./shared/channels"
export {
  CONNECTOR_ACTION_STATES,
  CONNECTOR_PERMISSIONS,
  CONNECTOR_READINESS_STATES,
  CONNECTOR_SESSIONS,
  connectorToolName,
  isTerminalActionState,
  TERMINAL_ACTION_STATES,
} from "./shared/connectors"
export type * from "./shared/environment"
export {
  BOT_ENVIRONMENT_SPEC_KEYS,
  DEFAULT_BOT_ENVIRONMENT_SPEC,
} from "./shared/environment"
export type * from "./shared/environment-host"
export { ENVIRONMENT_HOST_PROBLEM_CODES } from "./shared/environment-host"
export type * from "./shared/files"
export { BOT_FILE_ERROR_CODES } from "./shared/files"
export type * from "./shared/managed-sessions"
export { DEFAULT_ANSWERER } from "./shared/managed-sessions"
export type * from "./shared/models"
export {
  BOT_MODEL_ROLES,
  BOT_MODELS_ERROR_CODES,
  DEFAULT_BOT_MODELS,
  PROFILE_DEFAULT_MODEL,
} from "./shared/models"
export type * from "./shared/permission"
export { BOT_PERMISSION } from "./shared/permission"
export type * from "./shared/preset"
export { BOT_PRESET_PREFIX, botPresetId, DEFAULT_TEMPLATE_ID } from "./shared/preset"
export type * from "./shared/prompt"
export { BOT_PROMPT_EXCLUSIONS } from "./shared/prompt"
export type * from "./shared/web"
export {
  BOT_WEB_CAPABILITIES,
  BOT_WEB_ERROR_CODES,
  DEFAULT_WEB_BACKEND,
  DEFAULT_WEB_SETTINGS,
} from "./shared/web"

export const name = "bot-core"

/**
 * Host services this plugin reads. `agentPresets` is required: a bot session
 * must run under the bot's composed preset, and without the registry there is
 * nothing to compose from, so the row waits for it instead of starting bots
 * that cannot keep that promise. `workingDirectory` is read to answer its
 * `working-directory/access` waterfall for bot Agents. `llm` and
 * `agentDefaultModel` give the bots' model roles their routes, checked
 * against DSH's registry (docs/specs/bot-models.md).
 * `typert` takes the declared contract of bot-core's Remote. `approval` and
 * `sandboxPolicy` hold the permission bot-core sets on every bot session.
 */
export const inject = [
  "typert",
  "storageDomain",
  "workspaceRegistry",
  "sessionController",
  "agentPresets",
  "tools",
  "agents",
  "agentDefaultModel",
  "llm",
  "workingDirectory",
  "approval",
  "sandboxPolicy",
]

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    bot: { kind: "bot"; form: "notice"; summary: string }
    /** bot-core's notices of connector actions that ended after their call returned. */
    "bot-connector": { kind: "bot-connector"; form: "notice"; summary: string }
    /** bot-core's notices of schedule runs, and the prompt of a separate run's session. */
    "bot-schedule": { kind: "bot-schedule"; form: "notice"; summary: string }
    /** bot-core's prompt of a background skill review (docs/specs/bot-skills.md §6). */
    "bot-skills": { kind: "bot-skills"; form: "notice"; summary: string }
    /** bot-core's notice of the notes an owner's message names (docs/specs/bot-notes.md §5). */
    "bot-notes": { kind: "bot-notes"; form: "notice"; summary: string }
    /** bot-core's notices of connectors' events (new emails, changed calendar events). */
    "bot-connector-event": { kind: "bot-connector-event"; form: "notice"; summary: string }
    /** bot-core's maintenance turns of a Main session (docs/specs/bot-main-rotation.md §9). */
    "bot-main": { kind: "bot-main"; form: "notice"; summary: string }
    /** bot-core's notices of files the Main session presented that did not reach a channel. */
    "bot-file": { kind: "bot-file"; form: "notice"; summary: string }
    /** bot-core's notices of managed sessions (docs/specs/bot-managed-sessions.md §7). */
    "bot-session": { kind: "bot-session"; form: "notice"; summary: string }
    /** What a bot's Main session sends a session it manages. */
    "bot-main-relay": { kind: "bot-main-relay"; form: "relay" }
    /** Declared by dsh-working-directory; bot-core commits a bot's directory changes the same way. */
    "working-directory": { kind: "working-directory" }
  }
}

export const DEFAULT_GREETING =
  "You are {name}. This is the very first moment of your Main session, the conversation your owner keeps with you. Greet your owner warmly and briefly in {language}, introduce yourself as {name}, and ask what they would like to do together."

/** Id of the only bot environment bot-core accepts unless configured otherwise. */
export const DEFAULT_ENVIRONMENT = "incus-vm"

/** How long placing a bot's initial workspace files (and notes) may take. */
const WORKSPACE_FILES_TIMEOUT_MS = 60_000
/** Largest timer delay (as workspaceFiles bounds its search timers). */
const MAX_TIMER_MS = 2147483647
/** Subagents nested deeper below a bot's root session ask nobody through bot-core. */
const MAX_DELEGATION_DEPTH = 32
// dsh-ssh frames are at most 64 MiB and dsh-fs-ssh sends bytes base64 inside JSON.
const MAX_SSH_PAYLOAD_BYTES = 32 * 1024 * 1024
/** Inbox files travel through a process's stdin, not one SSH frame. */
const MAX_CHANNEL_FILE_BYTES = 512 * 1024 * 1024
/** Bounds reading one turn's presented files, which holds the Main session's later outputs back. */
const PRESENTED_READ_MS = 60_000
/** How long a channel may take to answer about settings (a save's check, options, inspection). */
const CHANNEL_QUERY_MS = 15_000
/** How long one read of the GitHub releases may take. */
const RELEASES_READ_LIMIT_MS = 20_000
/** Retrying a failed read of the release notes: from a minute, doubling, up to an hour. */
const RELEASES_RETRY = { firstMs: 60_000, maxMs: 60 * 60_000 } as const

export const DEFAULT_CHANNEL_LIMITS = {
  attachments: { maxCount: 10, maxFileBytes: 25 * 1024 * 1024, maxMessageBytes: 50 * 1024 * 1024 },
  files: { maxBytes: 25 * 1024 * 1024 },
} as const

export const Config = z.object({
  greeting: z
    .string()
    .default(DEFAULT_GREETING)
    .description(
      "Prompt the system sends to a new Main session so the bot speaks first. {name} is the bot's name, {language} the English name of its language (General settings); an empty value uses the default.",
    ),
  allowedPlugins: z
    .array(z.string())
    .default([])
    .description(
      "Plugin packages an overlay from outside (configurePreset) may add, besides those registered templates use. Package names only; paths, URLs and include rows are always refused.",
    ),
  allowedHostTools: z
    .array(z.string())
    .default([])
    .description(
      "Host (global) tools a bot template may grant its bots through hostTools. They run on the Host, outside the bot's environment; a template naming any other is refused.",
    ),
  environment: z
    .string()
    .default(DEFAULT_ENVIRONMENT)
    .description(
      "Id of the only bot environment (registered by another plugin) bot-core accepts; bots run only inside it.",
    ),
  files: z
    .object({
      maxBytes: z
        .natural()
        .min(1)
        .max(MAX_SSH_PAYLOAD_BYTES)
        .default(DEFAULT_FILES_LIMITS.maxBytes)
        .description(
          "Byte cap on one text page and on one byte window of a bot's file; larger ones are refused.",
        ),
      maxFileBytes: z
        .natural()
        .min(1)
        .max(MAX_SSH_PAYLOAD_BYTES)
        .default(DEFAULT_FILES_LIMITS.maxFileBytes)
        .description(
          "Byte cap on reading a bot's complete file (sent base64 over SSH and JSON); larger files are refused.",
        ),
      maxLines: z
        .natural()
        .min(1)
        .default(DEFAULT_FILES_LIMITS.maxLines)
        .description("Default and largest page of a bot's text file, in lines."),
      maxEntries: z
        .natural()
        .min(1)
        .default(DEFAULT_FILES_LIMITS.maxEntries)
        .description("Cap on the entries one directory listing of a bot's workspace returns."),
      maxConcurrent: z
        .natural()
        .min(1)
        .default(DEFAULT_FILES_LIMITS.maxConcurrent)
        .description("Calls of the botFiles Remote served at once per bot; more wait their turn."),
      confineReads: z
        .boolean()
        .default(DEFAULT_FILES_LIMITS.confineReads)
        .description(
          "Refuse reading a bot's files outside its workspace (listing and search always stay inside).",
        ),
      search: z
        .object({
          maxResults: z.natural().min(1).default(DEFAULT_FILES_LIMITS.search.maxResults),
          maxEntries: z.natural().min(1).default(DEFAULT_FILES_LIMITS.search.maxEntries),
          graceMs: z
            .natural()
            .min(1)
            .max(MAX_TIMER_MS)
            .default(DEFAULT_FILES_LIMITS.search.graceMs),
          timeoutMs: z
            .natural()
            .min(1)
            .max(MAX_TIMER_MS)
            .default(DEFAULT_FILES_LIMITS.search.timeoutMs),
          stderrMaxBytes: z.natural().min(1).default(DEFAULT_FILES_LIMITS.search.stderrMaxBytes),
          ripgrep: z
            .string()
            .default(DEFAULT_FILES_LIMITS.search.ripgrep)
            .description(
              "ripgrep inside the bot's environment: an absolute path, or a command its PATH resolves.",
            ),
        })
        .description(
          "Budgets of one search of a bot's workspace (ripgrep in the bot's environment).",
        ),
    })
    .description(
      "Caps of the botFiles Remote, which reads a bot session's files in the bot's environment.",
    ),
  channels: z
    .object({
      attachments: z
        .object({
          maxCount: z
            .natural()
            .min(1)
            .default(DEFAULT_CHANNEL_LIMITS.attachments.maxCount)
            .description(
              "Most attachments one channel message may bring (the channel may allow fewer).",
            ),
          maxFileBytes: z
            .natural()
            .min(1)
            .max(MAX_CHANNEL_FILE_BYTES)
            .default(DEFAULT_CHANNEL_LIMITS.attachments.maxFileBytes)
            .description(
              "Largest attachment saved in a bot's inbox (<workspace>/.inbox); images follow DSH's own image limits.",
            ),
          maxMessageBytes: z
            .natural()
            .min(1)
            .max(MAX_CHANNEL_FILE_BYTES)
            .default(DEFAULT_CHANNEL_LIMITS.attachments.maxMessageBytes)
            .description("Largest total of one message's attachments."),
        })
        .description(
          "What a person may attach to a message in a channel; more is refused, with the reason.",
        ),
      files: z
        .object({
          maxBytes: z
            .natural()
            .min(1)
            .max(MAX_SSH_PAYLOAD_BYTES)
            .default(DEFAULT_CHANNEL_LIMITS.files.maxBytes)
            .description(
              "Largest file a bot's Main session can present to its channels (each channel also has its own limit).",
            ),
        })
        .description("Files bots send to their channels."),
    })
    .description("Limits of what bots and people exchange through channels."),
})

/** How long a batch of connector events waits for more before its notice. */
const EVENT_BATCH_MS = 60_000
/** Events kept per bot, connector and account. */
const EVENTS_PER_STREAM = 500
/** How long told or acknowledged events are kept, and events nobody took. */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000
const UNREAD_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000
const EVENT_PRUNE_EVERY_MS = 60 * 60_000

/** How long ended connector actions stay in a bot's ledger. */
const CONNECTOR_RETENTION_MS = 7 * 24 * 60 * 60_000
/** How long a notice waits at start-up for its bot's preset before resuming the Main session anyway. */
const NOTICE_READY_WAIT_MS = 15_000
/** Backoff of a notice that could not be delivered. */
const NOTICE_RETRY = { initialMs: 5_000, maxMs: 10 * 60_000 } as const
/** Ended runs kept per schedule job. */
const SCHEDULE_RUNS_KEPT = 20
/** Longest a separate schedule run's session may take. */
const SEPARATE_RUN_LIMIT_MS = 60 * 60_000
/** Longest one maintenance of a Main (its preparations and an idle compaction) may take. */
export const MAIN_MAINTENANCE_LIMIT_MS = 5 * 60_000
/** How long a Main maintenance that did not happen keeps the next automatic one off (doubling). */
const MAIN_MAINTENANCE_RETRY = { initialMs: 5 * 60_000, maxMs: 2 * 60 * 60_000 } as const

/** The configuration as resolved by {@link Config}: every field present, defaults applied. */
export type BotCoreConfig = ReturnType<typeof Config>

interface BotsDomain {
  table(name: "bots"): BotTable
  table(name: "sessions"): BotTable<BotSessionRecord>
  close(): Promise<void>
}

interface ConnectorsDomain {
  table(name: "actions"): BotTable<ConnectorAction>
  table(name: "permissions"): BotTable<PermissionRecord>
  table(name: "settings"): BotTable<SettingsRecord>
  close(): Promise<void>
}

interface NoticesDomain {
  table(name: "notices"): BotTable<NoticeRecord>
  close(): Promise<void>
}

interface ModelsDomain {
  table(name: "models"): BotTable<BotModelsRecord>
  close(): Promise<void>
}

interface WebDomain {
  table(name: "settings"): BotTable<BotWebSettings>
  close(): Promise<void>
}

interface OnboardingDomain {
  table(name: "state"): BotTable<OnboardingRecord>
  close(): Promise<void>
}

interface SchedulesDomain {
  table(name: "jobs"): BotTable<JobRecord>
  table(name: "runs"): BotTable<RunRecord>
  close(): Promise<void>
}

interface VaultsDomain {
  table(name: "accounts"): BotTable<VaultAccountRecord>
  table(name: "grants"): BotTable<VaultGrantRecord>
  table(name: "uses"): BotTable<VaultUseRecord>
  table(name: "fingerprints"): BotTable<VaultFingerprintRecord>
  table(name: "incidents"): BotTable<VaultIncidentRecord>
  close(): Promise<void>
}

/** scrypt's cost (docs/specs/bot-vaults.md §7.1). */
const GUARD_SCRYPT = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const GUARD_DIGEST_BYTES = 32

const guardDigest = (bytes: Uint8Array, salt: Uint8Array): Promise<string> =>
  new Promise((resolve, reject) => {
    scrypt(bytes, salt, GUARD_DIGEST_BYTES, GUARD_SCRYPT, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key.toString("base64"))
    })
  })

/** Most bytes of text one scan of the vault guard reads (docs/specs/bot-vaults.md §7.2). */
const GUARD_SCAN_LIMIT = 2 * 1024 * 1024

const guardKeyCache = new WeakMap<GuardKeyMaterial, GuardKeys>()

/** The guard's keys of the key material (records hand out the same material object), derived once. */
function derivedGuardKeys(material: GuardKeyMaterial): GuardKeys {
  const known = guardKeyCache.get(material)
  if (known !== undefined) return known
  const keys = guardKeysOf(material)
  guardKeyCache.set(material, keys)
  return keys
}

/** The guard's keys, derived from the installation's key material with HKDF. */
function guardKeysOf(material: GuardKeyMaterial): GuardKeys {
  const key = Buffer.from(material.key, "base64")
  const salt = Buffer.from(material.salt, "base64")
  const derive = (info: string, length: number) =>
    new Uint8Array(hkdfSync("sha256", key, salt, `dsh-bot-core vault-guard ${info}`, length))
  return {
    id: Buffer.from(derive("key id", 8)).toString("hex"),
    hash: rollingHashFrom(derive("rolling hash", ROLLING_HASH_BYTES)),
    salt,
  }
}

interface ConnectionsDomain {
  table(name: "connections"): BotTable<ConnectionRecord>
  table(name: "grants"): BotTable<GrantRecord>
  table(name: "clients"): BotTable<ClientRecord>
  close(): Promise<void>
}

interface EventsDomain {
  table(name: "events"): BotTable<EventRecord>
  table(name: "cursors"): BotTable<CursorRecord>
  close(): Promise<void>
}

/** DSH's web server (dsh-host-webserver), as bot-core's OAuth callback route registers on it. */
interface WebServerServices {
  webServer: {
    register(route: {
      readonly kind: "exact"
      readonly path: string
      resource(request: Request): Promise<Response>
    }): () => void
  }
}

interface SkillsDomain {
  table(name: "history"): BotTable<SkillHistoryRecord>
  table(name: "usage"): BotTable<SkillUsageRecord>
  table(name: "settings"): BotTable<SkillSettingsRecord>
  table(name: "marks"): BotTable<SkillMarkRecord>
  table(name: "curation"): BotTable<SkillCurationRecord>
  close(): Promise<void>
}

interface ManagedSessionsDomain {
  table(name: "sessions"): BotTable<ManagedSessionRecord>
  table(name: "workspaces"): BotTable<WorkspaceGrantRecord>
  close(): Promise<void>
}

interface MainsDomain {
  table(name: "settings"): BotTable<StoredMainSettings>
  table(name: "overrides"): BotTable<StoredMainOverride>
  table(name: "activity"): BotTable<MainActivityRecord>
  close(): Promise<void>
}

/** DSH's `tokenMeter` service (dsh-token-meter), as the Main's context fill is read from it. */
interface TokenMeterServices {
  tokenMeter: {
    contextPressure(session: LiveAgent["session"]): {
      readonly pressureTokens?: number
      readonly contextWindow?: number
    }
  }
}

interface EnvironmentSpecsDomain {
  table(name: "specs"): BotTable<EnvironmentSpecRecord>
  close(): Promise<void>
}

/**
 * DSH's `sessionQuery` service (dsh-session-query), as a bot's past
 * conversations are read from it: a session's raw log, live or stored,
 * without loading its Agent. It checks no caller, so only this wiring names
 * it (design rule 55) and host/conversations/ decides what may be read.
 */
interface SessionQueryServices {
  sessionQuery: {
    observeSession(
      sessionId: string,
      options: { readonly signal: AbortSignal; readonly projectionMode: "none" },
    ): Promise<SessionLog & Disposable>
  }
}

const SESSION_NOT_FOUND = "SESSION_QUERY_SESSION_NOT_FOUND"

/** DSH's `attachments` service, as the Main view reads people's images. */
interface AttachmentReads {
  readonly attachments: {
    readImage(ref: MainImageRef, signal?: AbortSignal): Promise<{ readonly data: Uint8Array }>
  }
}

interface ChannelsDomain {
  table(name: "channels"): BotTable<ChannelRecord>
  close(): Promise<void>
}

interface HostServices {
  typert: TypertRegistry
  storageDomain: {
    open(spec: typeof BOTS_DOMAIN): Promise<BotsDomain>
    open(spec: typeof CHANNELS_DOMAIN): Promise<ChannelsDomain>
    open(spec: typeof CONNECTORS_DOMAIN): Promise<ConnectorsDomain>
    open(spec: typeof NOTICES_DOMAIN): Promise<NoticesDomain>
    open(spec: typeof SCHEDULES_DOMAIN): Promise<SchedulesDomain>
    open(spec: typeof CONNECTIONS_DOMAIN): Promise<ConnectionsDomain>
    open(spec: typeof VAULTS_DOMAIN): Promise<VaultsDomain>
    open(spec: typeof EVENTS_DOMAIN): Promise<EventsDomain>
    open(spec: typeof WEB_DOMAIN): Promise<WebDomain>
    open(spec: typeof MAINS_DOMAIN): Promise<MainsDomain>
    open(spec: typeof SKILLS_DOMAIN): Promise<SkillsDomain>
    open(spec: typeof MODELS_DOMAIN): Promise<ModelsDomain>
    open(spec: typeof MANAGED_SESSIONS_DOMAIN): Promise<ManagedSessionsDomain>
    open(spec: typeof ENVIRONMENT_SPECS_DOMAIN): Promise<EnvironmentSpecsDomain>
    open(spec: typeof ONBOARDING_DOMAIN): Promise<OnboardingDomain>
  }
  workspaceRegistry: {
    readonly archivedSessionIds: readonly string[]
    unarchiveSession(sessionId: string): Promise<void>
    archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
    /** Legacy bots only: the Workspace a version 1 record names. */
    get(id: string): { sessionIds: readonly string[] } | undefined
    delete(id: string): Promise<boolean>
    /** DSH's Workspaces in their order (managed Workspace sessions). */
    list(): readonly {
      readonly id: string
      readonly title: string
      readonly path: string
      readonly sessionIds: readonly string[]
    }[]
  }
  sessionController: {
    /** `session.create` in a Workspace (managed Workspace sessions, docs/specs/bot-managed-sessions.md §10.2). */
    create(request: {
      workspaceId: string
      agentPreset: string
    }): Promise<{ sessionId: string; agentPreset?: string }>
    /** Resolves the Agent (live or resumed) and appends a user-owned `session/title`. */
    rename(request: { sessionId: string; title: string }): Promise<unknown>
    resolveAgent(sessionId: string): Promise<{ agent: AgentLike } | { error: unknown }>
    /** The Remote method the Web composer calls (`session.prompt`); outside a Remote call the caller is the owner. */
    prompt(
      request: {
        requestId: string
        sessionId: string
        mode: "queue" | "steer"
        content: readonly PromptPart[]
        clientTimeZone?: string
      },
      signal: AbortSignal,
    ): Promise<{ accepted: true }>
    /** The Remote method the Web UI's stop calls (`session.cancel`): the turn ends, its inbox stays. */
    cancel(request: { sessionId: string }): { accepted: true }
  }
  agentDefaultModel: {
    currentSelection(): BotModelSelection
  }
  llm: LlmRegistry
  workingDirectory: {
    /** The recorded directory of a session, without I/O. */
    get(session: LiveAgent["session"]): string
  }
  approval: { overrideOf(session: LiveAgent["session"]): ApprovalPolicy | undefined }
  sandboxPolicy: { overrideOf(session: LiveAgent["session"]): SandboxMode | undefined }
}

/** DSH's `permissionPresets` service (dsh-permission-presets). */
interface PermissionPresetServices {
  permissionPresets: PermissionPresets<LiveAgent["session"]>
}

interface AgentLike {
  followup(message: ReturnType<typeof createUserMessage>): void
}

/** The slice of a live Agent bot-core uses. */
interface LiveAgent {
  readonly id: string
  readonly ctx: Context
  readonly status: "idle" | "running"
  readonly model: {
    current(): BotModelSelection | undefined
    select(selection: BotModelSelection): void
  }
  readonly inbox: {
    readonly nextTurn: readonly {
      readonly id: string
      readonly source: { readonly kind: string }
    }[]
    readonly nextStep: readonly {
      readonly id: string
      readonly source: { readonly kind: string }
    }[]
    remove(messageId: string): boolean
  }
  readonly session: {
    readonly id: string
    readonly header: {
      readonly cwd?: string
      readonly parentSession?: string
      readonly agentPreset?: string
      readonly origin?: string
    }
    append(type: "working-directory/change", data: { cwd: string }): unknown
    deriveMessages(): readonly TranscriptMessage[]
    ownEvents(): readonly LoggedEvent[]
    /** The whole log, contiguous from seq 0 (as DSH's fork backend reads a parent's). */
    snapshotEvents(): readonly ReviewSeedEvent[]
    /** The latest model request's route. */
    requestHeader():
      | { readonly config: { provider: string; model: string; reasoningEffort?: string } }
      | undefined
  }
  inject(message: UserMessage): void
  followup(message: UserMessage): void
}

/** A notice's message as DSH's user message (same fields; the notice source is declared above). */
function asUserMessage(message: NoticeMessage): UserMessage {
  return message as unknown as UserMessage
}

/** A live Main session Agent as notice delivery sees it. */
function noticeAgentOf(agent: LiveAgent): NoticeAgent {
  return {
    get status() {
      return agent.status
    },
    queued: (messageId) =>
      [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(
        (message) => message.id === messageId,
      ),
    unqueue(messageId) {
      agent.inbox.remove(messageId)
    },
    recorded: (messageId) =>
      agent.session.deriveMessages().some((message) => message.id === messageId),
    followup: (message) => agent.followup(asUserMessage(message)),
    inject: (message) => agent.inject(asUserMessage(message)),
  }
}

interface ToolsService {
  /**
   * Visible `ToolDefinition`s of a scope (an Agent), or of the global view.
   * The definitions themselves, passed to isolation unchanged: it compares
   * them by identity (dsh-tools `definitions(scope?, toolSet?)`).
   */
  definitions(scope?: object): readonly ToolEntry[]
}

interface PresetServices {
  agentPresets: {
    register(preset: ComposedPreset): Promise<() => Promise<void>>
    resolve(id: string): Promise<{ id: string; broken?: string }>
    composedPreset(ctx: Context): string | undefined
    select(agent: LiveAgent, agentPreset: string): Promise<string>
    /** Every declared preset with its load failure (`agentPresets.list`). */
    list(): Promise<readonly { id: string; name?: string; broken?: string }[]>
    /** The preset a session runs when none is named. */
    readonly defaultId: string
    /** Bind an unpublished Agent to the preset's current revision (session-controller's setup). */
    mount(ctx: Context, id: string): Promise<{ id: string }>
    /** A service provided inside the Agent's preset group, e.g. its environment's `fs`. */
    serviceFor(agent: { ctx: Context }, name: "fs"): EnvironmentFs | undefined
  }
  tools: ToolsService
  agents: {
    list(): LiveAgent[]
    get(id: string): LiveAgent | undefined
    /** The Agent whose work is running in this async chain, if any (dsh-agent). */
    currentInitiator(): LiveAgent | undefined
    /** Run work outside any Agent's initiator scope (dsh-agent). */
    withoutInitiator<T>(operation: () => T): T
    /** dsh-agent `AgentRegistry.create`: the caller's context owns the new Agent. */
    create(options: {
      sessionId: string
      agentOptions: object
      meta: {
        cwd: string
        agentPreset: string
        parentSession?: string
        isSeeded?: boolean
        origin?: "subagent"
      }
      seed?: readonly ReviewSeedEvent[]
      inheritedEventCount?: number
      setup(agentCtx: Context, agent: LiveAgent): Promise<void>
    }): Promise<{ agent: LiveAgent; dispose(): Promise<void> }>
  }
}

/** DSH's `credentials` service (dsh-credentials), as the channel vault uses it. */
interface CredentialServices {
  credentials: CredentialRecords
}

/** DSH's `attachments` service (dsh-attachment), as channel images are checked against it. */
interface AttachmentServices {
  attachments: { readonly imageLimits: ImageLimits }
}

/** DSH's `settings` service (dsh-settings), as the composer preference is read from it. */
interface SettingsServices {
  settings: { describe(): readonly SettingsForm[] }
}

/** DSH's `userQuestions` service (dsh-user-questions), as bot-core answers for bot sessions. */
interface UserQuestionsServices {
  userQuestions: {
    attachWait(
      agent: LiveAgent,
      callId: string,
      signal: AbortSignal,
    ): AsyncIterable<{ remainingMs: number }>
    answer(agent: LiveAgent, callId: string, answer: DshQuestionAnswer): boolean
  }
  sessionProjections: {
    snapshot(
      session: LiveAgent["session"],
      keys: readonly ["userQuestions"],
    ): { values: { userQuestions?: { active: readonly DshPendingQuestion[] } } }
    onChanged(listener: (session: { id: string }, key: string) => void): () => void
  }
}

/** The tools service as an Agent's scoped context reaches it. */
interface ScopedTools {
  tools: {
    restrict(filter: { deny: readonly string[] }): () => void
    guard(guard: (execution: { readonly name: string }) => string | undefined): () => void
  }
}

interface HostEvents {
  on(
    name: string,
    // biome-ignore lint/suspicious/noExplicitAny: listener payloads are narrowed at the call site
    listener: (...args: any[]) => unknown,
    options?: { prepend?: boolean },
  ): () => void
}

/** How long after start-up a scheduled resume of a bot session may wait for presets. */
const RESUME_WAIT_MS = 15_000

/** How long a resumed Main waits for its pending main model to be checked before it may start a turn. */
const MAIN_MODEL_WAIT_MS = 10_000

/** Longest a background skill review runs. */
const SKILL_REVIEW_LIMIT_MS = 5 * 60_000
/** Longest a skill curation by the model runs. */
const SKILL_CURATION_LIMIT_MS = 10 * 60_000
/** Longest the daily archive of a bot's unused skills, or a reading of them for the curation, may take. */
const SKILL_SWEEP_LIMIT_MS = 2 * 60_000
/** Longest one reading of a bot's skills for the Web UI may take. */
const SKILL_READ_LIMIT_MS = 60_000
/** How long one reading of a bot's notes for the Web UI may take. */
const NOTES_READ_LIMIT_MS = 60_000

/** How long a new session waits for its environment to answer. */
const ENVIRONMENT_WAIT_MS = 3 * 60_000
/** Pause between two checks of a new session's environment. */
const ENVIRONMENT_INTERVAL_MS = 3_000
/** Deadline of one check (an SSH connect may take two handshakes of 30 s). */
const ENVIRONMENT_PROBE_MS = 75_000

/**
 * Registers the `bot` service, the durable bot list and its `bots` Remote,
 * and keeps one Agent preset per bot registered and its Agents isolated.
 *
 * Order matters at start-up: the Host may resume sessions (a due schedule, a
 * reconnecting client) without waiting for this plugin, and a session whose
 * bot preset is not registered yet fails with "Unknown agent preset". So the
 * template catalog and the bots' presets come first, right after the bot
 * records are readable, scheduled resumptions of bot sessions wait for them
 * (within a start-up window), and everything else follows without waiting.
 */
export async function apply(ctx: Context, config: BotCoreConfig): Promise<void> {
  const services = ctx as unknown as HostServices
  const host = ctx as unknown as PresetServices
  const events = ctx as unknown as HostEvents
  const warn = (message: string) => ctx.logger.warn(message)
  const startedAt = Date.now()

  // Timers end with the plugin: nothing runs against an unloaded context.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let unloading = false
  const unload = new AbortController()
  let stop: () => void = () => {}
  const stopped = new Promise<void>((resolveStop) => {
    stop = resolveStop
  })
  /** Ends every wait (it checks `unloading`); the unload order runs it first. */
  const halt = () => {
    unloading = true
    unload.abort()
    stop()
  }
  ctx.effect(
    () => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      halt()
    },
    "bot-core: timers",
  )
  const later = (work: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      work()
    }, ms)
    timers.add(timer)
    return () => {
      clearTimeout(timer)
      timers.delete(timer)
    }
  }
  /** Resolves after `ms`, or as soon as the plugin unloads. */
  const sleep = (ms: number) =>
    Promise.race([new Promise<void>((done) => void later(done, ms)), stopped])

  const newBotId = () => randomUUID().slice(0, 8)

  const catalog = createTemplateCatalog({ warn })
  ctx.effect(() => catalog.register(defaultTemplate()), "bot-core: default template")

  const domain = await services.storageDomain.open(BOTS_DOMAIN)
  ctx.effect(() => () => void domain.close(), "bot-core: storage domain")
  const table = domain.table("bots")

  const botIds = () => [...table.entries()].map(([id]) => id)

  // Model roles (docs/specs/bot-models.md): each bot's main, utility and
  // delegate models, checked against DSH's LLM registry.
  const modelsDomain = await services.storageDomain.open(MODELS_DOMAIN)
  ctx.effect(() => () => void modelsDomain.close(), "bot-core: models storage domain")
  const modelStore = createBotModelStore({ models: modelsDomain.table("models"), now: Date.now })
  const profileDefault = (): BotModelSelection => services.agentDefaultModel.currentSelection()
  const modelCatalog = createModelCatalog({ llm: services.llm, profileDefault })
  const botModels = createBotModels({
    store: modelStore,
    catalog: modelCatalog,
    profileDefault,
    exists: (botId) => table.get(botId) !== undefined,
  })
  // Before anything reads them: bots stored before model roles get the defaults.
  await modelStore.migrate(botIds())

  // Web lookup (README, "Web lookup"): every bot's web_search / web_fetch go
  // through the backend the settings name, with bot-core's own secrets.
  const webDomain = await services.storageDomain.open(WEB_DOMAIN)
  ctx.effect(() => () => void webDomain.close(), "bot-core: web storage domain")
  /** Whether an earlier start stored the web lookup settings: bot-core ran here before (onboarding). */
  const webSettingsStoredBefore = webDomain.table("settings").get(WEB_SETTINGS_KEY) !== undefined
  const webStore = await openWebSettingsStore({ webSettings: webDomain.table("settings") })
  const webBackends = createWebBackendCatalog()
  const webState = createWebState({ store: webStore, catalog: webBackends, warn })
  ctx.effect(() => () => webState.dispose(), "bot-core: web lookup state")
  /**
   * What every bot's tool-web rows may offer: what the settings' backend can
   * serve. Whether a capability is on is read per turn by the bridge, since a
   * live Agent keeps the revision it started with.
   */
  const webComposition = (): WebComposition => webState.servable()

  // Connectors (README, "Connectors"): the registered ones, and each bot's
  // settings and permissions of them; the rest is wired below.
  const connectorsDomain = await services.storageDomain.open(CONNECTORS_DOMAIN)
  ctx.effect(() => () => void connectorsDomain.close(), "bot-core: connectors storage domain")
  const connectorCatalog = createConnectorCatalog()
  const connectorPermissions = createConnectorPermissions({
    records: connectorsDomain.table("permissions"),
    catalog: connectorCatalog,
    now: Date.now,
  })
  // Each bot's environment spec (docs/specs/bot-vm-spec.md). Its saves and the
  // connector settings' share one queue: each checks the other's state.
  const specsDomain = await services.storageDomain.open(ENVIRONMENT_SPECS_DOMAIN)
  ctx.effect(() => () => void specsDomain.close(), "bot-core: environment specs storage domain")
  const botSettingsQueue = createSaveQueue()
  const specStore = createEnvironmentSpecStore({
    records: specsDomain.table("specs"),
    queue: botSettingsQueue,
    needs: (botId) => connectorNeeds(botId),
    now: Date.now,
  })
  const connectorSettings = createConnectorSettings({
    records: connectorsDomain.table("settings"),
    catalog: connectorCatalog,
    queue: botSettingsQueue,
    spec: (botId) => specStore.get(botId),
    now: Date.now,
  })
  const connectorNeeds = (botId: string) =>
    environmentNeeds(connectorCatalog.list(), (connectorId) =>
      connectorSettings.enabled(botId, connectorId),
    )
  // Connections (README, "Connections"): outside accounts connectors act as,
  // signed in with OAuth by the owner; their tokens stay on the Host.
  const connectionsDomain = await services.storageDomain.open(CONNECTIONS_DOMAIN)
  ctx.effect(() => () => void connectionsDomain.close(), "bot-core: connections storage domain")
  const connectionStore = createConnectionStore({
    connections: connectionsDomain.table("connections"),
    grants: connectionsDomain.table("grants"),
    clients: connectionsDomain.table("clients"),
    now: Date.now,
  })
  // Onboarding (docs/specs/bot-onboarding.md): the welcome guide and the
  // release notes every page shows until one finishes it. Opened before any
  // Remote can store a bot, so a first start sees only what earlier ones left.
  const onboardingDomain = await services.storageDomain.open(ONBOARDING_DOMAIN)
  ctx.effect(() => () => void onboardingDomain.close(), "bot-core: onboarding storage domain")
  const releases = releaseSourceOf(manifest)
  const onboardingStore = await openOnboardingStore({
    onboardingState: onboardingDomain.table("state"),
    prior: () => ({
      bots: botIds().length > 0,
      webSettings: webSettingsStoredBefore,
      oauthClients: [...connectionsDomain.table("clients").entries()].length > 0,
    }),
    version: releases.version,
    now: Date.now,
  })
  // The notes of the releases since the stored version, from its GitHub releases (English).
  const releaseNotes = createReleaseNotesKeeper({
    version: releases.version,
    seen: () => onboardingStore.current().notesSeen,
    subscribe: (listener) => onboardingStore.subscribe(listener),
    fetch: (seen, signal) =>
      fetchDueNotes(
        { fetch: (url, init) => fetch(url, init), repository: releases.repository },
        seen,
        releases.version,
        AbortSignal.any([signal, AbortSignal.timeout(RELEASES_READ_LIMIT_MS)]),
      ),
    record: async (version) => {
      await onboardingStore.change((current) =>
        acknowledging(current, version, releases.version, Date.now()),
      )
    },
    later,
    retry: RELEASES_RETRY,
    warn,
  })
  ctx.effect(() => () => releaseNotes.dispose(), "bot-core: release notes")
  const connectionProviders = createConnectionProviders()
  const connectionServices = createConnectionServices(connectorCatalog)
  const connectorAccounts = createConnectorAccounts(connectionStore)
  let credentialRecords: ConnectionCredentialRecords | undefined
  const credentials = (): ConnectionCredentialRecords => {
    if (credentialRecords === undefined) {
      throw new Error("DSH's credential store is not available, so no connection can be used")
    }
    return credentialRecords
  }
  const connectionVault = createConnectionVault({
    readRecord: (key) => credentials().readRecord(key),
    modifyRecord: (key, mutate) => credentials().modifyRecord(key, mutate),
    deleteRecord: (key) => credentials().deleteRecord(key),
  })
  const oauthClients = createOAuthClients({ store: connectionStore, vault: connectionVault, warn })
  const oauthFetch: OAuthFetch = (url, init) => fetch(url, init)
  const connectionTokens = createConnectionTokens({
    store: connectionStore,
    vault: connectionVault,
    providers: connectionProviders,
    client: (provider) => oauthClients.credentials(provider),
    fetch: oauthFetch,
    now: Date.now,
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  const connectionOf = (record: ConnectionRecord) => ({
    info: connectionInfo(record),
    accessToken: (options?: { readonly refresh?: boolean }) =>
      connectionTokens.accessToken(record.id, options),
  })
  const accountName = (connectionId: string) => {
    const record = connectionStore.get(connectionId)
    return record === undefined ? connectionId : connectionName(record)
  }
  ctx.inject(["credentials"], (credentialsCtx) => {
    const records = (credentialsCtx as unknown as { credentials: ConnectionCredentialRecords })
      .credentials
    credentialsCtx.effect(() => {
      credentialRecords = records
      for (const provider of connectionProviders.list()) void oauthClients.load(provider.id)
      return () => {
        credentialRecords = undefined
      }
    }, "bot-core: connection credentials")
  })

  // The bots' execution environment (one VM per bot, registered by another
  // plugin). Without it, or until it is ready for a bot, no bot preset is
  // registered. Disposed with the presets, in the unload order below.
  const environments = createEnvironmentKeeper({
    target(botId) {
      const record = table.get(botId)
      return record === undefined ? undefined : { id: botId, name: record.name }
    },
    spec: (botId) => specStore.get(botId),
    adopt: async (botId, inspected) =>
      specStore.adopt(
        botId,
        inspected === undefined
          ? { origin: "default", spec: await initialSpecs.spec(botId, connectorNeeds(botId)) }
          : { origin: "inspected", spec: inspected },
      ),
    botIds,
    // A bot whose creation failed waits for a retry.
    held: (botId) => table.get(botId)?.creationFailure !== undefined,
    // A deleted bot's preset goes before its environment.
    release: (botId) => realizer.refresh(botId),
    later,
    now: Date.now,
    warn,
    acceptedId: config.environment,
  })
  const initialSpecs = createInitialSpecs({ environment: environments })

  /** Per-load secret of the files rows' tokens (see host/preset/compose.ts). */
  const filesSecret = randomBytes(32)
  const realizer = createPresetRealizer({
    catalog,
    source: (botId) => table.get(botId),
    botIds,
    allowedHostTools: new Set(config.allowedHostTools),
    web: webComposition,
    environment: environments,
    // The files row's token: only bot-core can make one for a revision.
    seal: (revision) => createHmac("sha256", filesSecret).update(revision).digest("hex"),
    register: (preset) => host.agentPresets.register(preset),
    diagnose: async (presetId) => (await host.agentPresets.resolve(presetId)).broken,
    later,
    warn,
  })
  // Returned, so a reload waits for the old registrations to go.
  ctx.effect(() => () => realizer.dispose(), "bot-core: bot presets")
  // Start registering now; nothing below waits for it.
  const registered = realizer.refreshAll()
  // A backend that can serve other capabilities recomposes every bot; turning one on or off does not.
  ctx.effect(() => {
    let offered = JSON.stringify(webComposition())
    return webState.subscribe(() => {
      const next = JSON.stringify(webComposition())
      if (next === offered) return
      offered = next
      void realizer.refreshAll()
    })
  }, "bot-core: web lookup of bot presets")
  /** Tokens of the revisions registered during this load: their Agents keep them until they end (web lookup, prompt). */
  const revisionTokens = new Map<string, Set<string>>()
  ctx.effect(
    () =>
      realizer.subscribe((botId) => {
        const token = realizer.registration(botId)?.revisionToken
        if (token === undefined) return
        const tokens = revisionTokens.get(botId) ?? new Set<string>()
        tokens.add(token)
        revisionTokens.set(botId, tokens)
      }),
    "bot-core: revisions registered during this load",
  )
  const webBridge = createWebBridge({
    state: webState,
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    caller: () => host.agents.currentInitiator()?.id,
  })
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    const boundary = turnBoundaryOf(event)
    if (boundary?.edge === "start") webBridge.turnStarted(session.id)
    if (boundary?.edge === "end") webBridge.turnEnded(session.id)
  })
  ctx.inject(["credentials"], (webCtx) => {
    const credentials = (webCtx as unknown as CredentialServices).credentials
    webCtx.effect(
      () => webState.attachVault(createWebSecretVault(credentials)),
      "bot-core: web lookup secrets",
    )
  })
  void environments.sync()
  // A change of the environment (registered, ready for a bot, failed) also
  // retries a composition whose mount failed before.
  ctx.effect(
    () => environments.subscribe((botId) => void realizer.refresh(botId, { retry: true })),
    "bot-core: bot environment changes",
  )

  const greeting = config.greeting.trim().length > 0 ? config.greeting : DEFAULT_GREETING

  const renameMain = async (sessionId: string, title: string) => {
    await services.sessionController.rename({ sessionId, title })
  }

  /** DSH's default model as live accessors, as the session controller gives its sessions. */
  const profileDefaultOptions = () => ({
    get provider() {
      return profileDefault().provider
    },
    get model() {
      return profileDefault().model
    },
    get reasoningEffort() {
      return profileDefault().reasoningEffort
    },
  })

  /**
   * A bot session's Agent, created the way DSH's session controller creates
   * one (`createAgent` and `composeAgent`: model selection, the preset
   * mounted in setup) but without its Host `mkdir`: `cwd` is the
   * environment's workspace, which exists only there. A fixed model is
   * recorded on the session in setup (`model/selection`, as dsh-agent-loop's
   * configured routes are), so a resume keeps it; `profile-default` gets DSH's
   * default as live accessors, as DSH's own sessions do. The Agent belongs to
   * this context, like a session controller's to its own; after an unload the
   * session controller resumes the session.
   */
  /** Sessions being created through Bot.createSession, which records them itself (with their membership). */
  const creating = new Set<string>()
  const createAgent = async (request: {
    cwd: string
    agentPreset: string
    model: SessionModel
  }) => {
    const { model } = request
    let mounted: string | undefined
    const sessionId = `session-${randomUUID()}`
    creating.add(sessionId)
    const { agent } = await host.agents
      .create({
        sessionId,
        agentOptions: model.kind === "fixed" ? { ...model.selection } : profileDefaultOptions(),
        meta: { cwd: request.cwd, agentPreset: request.agentPreset },
        async setup(agentCtx, created) {
          installModelSelection(agentCtx)
          if (model.kind === "fixed") created.model.select(model.selection)
          mounted = (await host.agentPresets.mount(agentCtx, request.agentPreset)).id
        },
      })
      .finally(() => creating.delete(sessionId))
    return { sessionId: agent.id, agentPreset: mounted ?? request.agentPreset }
  }

  // Declared before the registry needs them; set right after it.
  let startMain: (bot: { id: string; name: string }) => Promise<string> = () =>
    Promise.reject(new Error("bot-core is starting"))
  let openMain: (bot: BotView) => void = () => {
    throw new Error("bot-core is starting")
  }

  const creationConnectors = createCreationConnectors({
    catalog: connectorCatalog,
    settings: connectorSettings,
  })
  const registry = createBotRegistry({
    table,
    sessions: domain.table("sessions"),
    admit() {
      if (environments.current() === undefined) {
        throw new Error("no bot environment is registered, so no bot can run; nothing was created")
      }
    },
    connectors: creationConnectors,
    specs: {
      initial: (id, connectors) =>
        initialSpecs.spec(
          id,
          environmentNeeds(connectors, () => true),
        ),
      create: (id, spec) => specStore.create(id, spec),
      discard: (id) => specStore.discard(id),
    },
    models: {
      initial: (change) => botModels.initial(change),
      store: (id, models) => modelStore.create(id, models),
      discard: (id) => modelStore.discard(id),
    },
    startMain: (bot) => startMain(bot),
    openMain: (bot) => openMain(bot),
    renameMain,
    canonicalTimezone(value) {
      if (typeof value !== "string") throw new Error("timezone must be a string")
      return canonicalTimezone(value)
    },
    warn,
    newId: newBotId,
    now: Date.now,
  })

  const preparations = createSessionPreparations()
  const lifecycle = createBotLifecycle({
    registry,
    environment: environments,
    preparations,
    preset: {
      settle: (botId) => realizer.refresh(botId),
      registered: (botId) => realizer.registration(botId) !== undefined,
    },
    cleanup: (bot) =>
      cleanupBotSessions(
        {
          archive: (id) => services.workspaceRegistry.archiveSession(id, { stopActivity: true }),
          deleteWorkspace: (id) => services.workspaceRegistry.delete(id),
        },
        bot,
      ),
    now: Date.now,
    warn,
  })

  // Before anything reads bots: those stored before bot time zones ran in the Host's.
  await registry.migrateTimezones(() => new Intl.DateTimeFormat().resolvedOptions().timeZone)

  // Version 1 bots owned a Host directory registered as a Workspace: their
  // sessions are recorded as theirs, and the Workspace registration goes.
  registry
    .migrateLegacy(
      (workspaceId) => services.workspaceRegistry.get(workspaceId)?.sessionIds,
      (workspaceId) => services.workspaceRegistry.delete(workspaceId),
    )
    .catch((error: unknown) => {
      warn(`bot-core: could not migrate the bots' legacy Workspaces: ${String(error)}`)
    })

  const sessions = createBotSessions({
    realizer,
    exists: (botId) => table.get(botId) !== undefined,
    workspace: () => environments.current()?.workspace,
    model: (botId, request) => botModels.sessionModel(botId, request),
    create: createAgent,
    adopt: (botId, sessionId, membership) => registry.adopt(botId, sessionId, membership),
    prepare: (sessionId) => prepareSession(sessionId, () => waitForSessionEnvironment(sessionId)),
    rename: renameMain,
    warn,
  })

  // A change naming main reaches the Main session once its Agent is loaded (now, or at its next resume).
  const mainModels = createMainModelApplier({
    store: modelStore,
    mainOf: (botId) => table.get(botId)?.mainSessionId,
    agent: (sessionId) => host.agents.get(sessionId),
    resolve: (choice) => botModels.resolve(choice),
    warn,
  })
  const applyMainModel = (botId: string) => {
    mainModels.apply(botId).catch((error: unknown) => {
      warn(`bot-core: could not apply the main model of bot "${botId}": ${String(error)}`)
    })
  }
  ctx.effect(() => modelStore.subscribe(applyMainModel), "bot-core: main model of Main sessions")

  /**
   * Wait until a new session's environment answers (host/main.ts `waitForEnvironment`).
   * @returns whether the session may go on (false only when unloading).
   */
  const waitForSessionEnvironment = (sessionId: string) => {
    const agent = host.agents.get(sessionId)
    const fs = agent === undefined ? undefined : host.agentPresets.serviceFor(agent, "fs")
    const workspace = environments.current()?.workspace ?? agent?.session.header.cwd
    return waitForEnvironment(
      {
        probe:
          fs === undefined || workspace === undefined
            ? undefined
            : async (signal: AbortSignal) => {
                const target = (await fs.resolve(workspace, { signal })) as never
                const info = await fs.stat(target, signal)
                if (info?.type !== "directory") throw new Error(`${workspace} is not a directory`)
              },
        sleep,
        now: Date.now,
        stopped: () => unloading,
        warn,
        budgetMs: ENVIRONMENT_WAIT_MS,
        intervalMs: ENVIRONMENT_INTERVAL_MS,
        probeTimeoutMs: ENVIRONMENT_PROBE_MS,
      },
      `session "${sessionId}"`,
    )
  }

  /** The session is being prepared (the browser shows it as getting ready) until `work` settles, in the background. */
  const prepareSession = (sessionId: string, work: () => Promise<unknown>) => {
    preparations.run(sessionId, work).catch((error: unknown) => {
      warn(`bot-core: could not prepare session "${sessionId}": ${String(error)}`)
    })
  }

  /**
   * A Main session, for a new bot or in place of the former Main: it starts on
   * the stored main model, so that choice is applied (a change made meanwhile
   * stays pending for applyMainModel once the record names the new Main).
   */
  const createMainSession = async (bot: { id: string; name: string }) => {
    const { main } = modelStore.get(bot.id).models
    const { sessionId } = await sessions.create(bot.id, { title: bot.name })
    await modelStore.markApplied(bot.id, main)
    return sessionId
  }
  startMain = createMainSession
  // The first turn reads AGENTS.md, SOUL.md and the pinned notes, so they are placed before the greeting.
  openMain = (bot) => {
    // A main change made while the Main was being created.
    applyMainModel(bot.id)
    const sessionId = bot.mainSessionId
    prepareSession(sessionId, async () => {
      if (!(await waitForSessionEnvironment(sessionId))) return
      await placeWorkspaceFiles(bot.id)
      const resolved = await services.sessionController.resolveAgent(sessionId)
      if ("error" in resolved) throw resolved.error
      resolved.agent.followup(
        createUserMessage({
          content: [{ type: "text", text: greetingText(greeting, bot).trim() }],
          source: { kind: "bot", form: "notice", summary: `${bot.name}: Main session started` },
        }),
      )
    })
  }

  /** Whose session an Agent runs, by identity (see host/preset/identity.ts). */
  const sessionOf = createSessionIdentity<LiveAgent>({
    isBot: (botId) => realizer.isBot(botId),
    recorded: (sessionId) => registry.botOfSession(sessionId),
    agent: (sessionId) => host.agents.get(sessionId),
  })
  /** The bot a session verifiably belongs to (never an unverified one's). */
  const sessionBotOf = (agent: LiveAgent) => botOfIdentity(sessionOf(agent))
  // Password managers (docs/specs/bot-vaults.md): accounts the owner connects,
  // the logins each bot may fill, and the leak guard over every tool call.
  const outlets = createChannelOutlets({ warn })
  const vaultsDomain = await services.storageDomain.open(VAULTS_DOMAIN)
  ctx.effect(() => () => void vaultsDomain.close(), "bot-core: vaults storage domain")
  const vaultStore = createVaultStore({
    vaultAccounts: vaultsDomain.table("accounts"),
    vaultGrants: vaultsDomain.table("grants"),
    vaultUses: vaultsDomain.table("uses"),
    vaultFingerprints: vaultsDomain.table("fingerprints"),
    vaultIncidents: vaultsDomain.table("incidents"),
    now: Date.now,
  })
  const vaultProviders = createVaultProviders()
  const vaultRecords = createVaultRecords({
    records: () => credentials(),
    random: (bytes) => randomBytes(bytes).toString("base64"),
  })
  const vaultSessions = createVaultSessions({
    store: vaultStore,
    providers: vaultProviders,
    records: vaultRecords,
    warn,
  })
  ctx.effect(() => () => void vaultSessions.dispose(), "bot-core: password manager sessions")
  const vaultAvailability = createVaultAvailability()
  const vaultGuard = createVaultGuard({
    store: vaultStore,
    keys: async () => derivedGuardKeys(await vaultRecords.guardKeys()),
    digest: guardDigest,
    scanLimit: GUARD_SCAN_LIMIT,
    report: (incident) =>
      outlets.publish(incident.botId, { kind: "credential-incident", incident }),
    newId: () => `vinc-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    now: Date.now,
  })
  const vaultAccess = createVaultAccess({
    store: vaultStore,
    providers: vaultProviders,
    sessions: vaultSessions,
    guard: vaultGuard,
    availability: vaultAvailability,
    newId: () => `vuse-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    now: Date.now,
    warn,
  })
  const vaultChecks = createVaultChecks({
    guard: vaultGuard,
    sessionOf: (agentId) => host.agents.get(agentId)?.session.id,
    warn,
  })
  const vaultRows = createVaultRows<LiveAgent>({
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    agent: (agentId) => host.agents.get(agentId),
    botOf: sessionBotOf,
    checks: vaultChecks,
    access: vaultAccess,
    store: vaultStore,
  })
  new BotVaultsRemoteService(
    ctx,
    createVaultPanel({
      store: vaultStore,
      providers: vaultProviders,
      sessions: vaultSessions,
      records: vaultRecords,
      access: vaultAccess,
      availability: vaultAvailability,
      guard: vaultGuard,
      fillers: () =>
        connectorCatalog
          .list()
          .filter((connector) => connector.tools.some((tool) => tool.vault === true))
          .map((connector) => ({ id: connector.id, name: connector.name })),
      onFillersChange: (listener) => connectorCatalog.subscribe(listener),
      exists: (botId) => table.get(botId) !== undefined,
      newId: (prefix) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      now: Date.now,
      deadline: (ms) => AbortSignal.timeout(ms),
    }),
  )
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    if (event.type !== "assistant/message") return
    const agent = host.agents.get(session.id)
    const botId = agent === undefined ? registry.botOfSession(session.id) : sessionBotOf(agent)
    if (botId === undefined) return
    const { message } = event.data as AssistantMessageData
    void vaultChecks.assistantMessage(botId, session.id, message.content)
  })
  /** Text bot-core hands a bot outside tool calls, its secrets withheld (docs/specs/bot-vaults.md §7.2). */
  const shieldContext = <T>(botId: string, value: T, tool?: string) =>
    vaultGuard.shield({ botId, ...(tool === undefined ? {} : { tool }) }, "bot-context", value)
  /** A Main session created before bot presets: locked down, never switched, reported. */
  const isLegacyMain = (sessionId: string): boolean => {
    for (const [, record] of table.entries()) {
      if (record.mainSessionId === sessionId) return !mainOnBotPreset(record)
    }
    return false
  }
  const presetOf = (agent: LiveAgent) => host.agentPresets.composedPreset(agent.ctx)
  const scoped = (agent: LiveAgent) => (agent.ctx as unknown as ScopedTools).tools
  const parentOf = (agent: LiveAgent) => {
    const parent = agent.session.header.parentSession
    return parent === undefined ? undefined : host.agents.get(parent)
  }

  const isolation = createIsolation<LiveAgent>({
    presetOf,
    sessionOf,
    isBot: (botId) => realizer.isBot(botId),
    registration: (botId) => realizer.registration(botId),
    parentOf,
    globalTools: () => host.tools.definitions(),
    visibleTools: (agent) => host.tools.definitions(agent),
    restrict: (agent, deny) => scoped(agent).restrict({ deny: [...deny] }),
    guard: (agent, guard) => scoped(agent).guard((execution) => guard(execution.name)),
    agents: () => host.agents.list(),
    label: (agent) => agent.id,
    warn,
  })
  ctx.effect(() => () => isolation.dispose(), "bot-core: bot tool isolation")

  type DshSession = Parameters<typeof setSandboxMode>[0]
  const permissions = createBotPermissions<LiveAgent["session"]>({
    sandboxOverride: (session) => services.sandboxPolicy.overrideOf(session),
    approvalOverride: (session) => services.approval.overrideOf(session),
    setSandboxMode: (session, mode) => setSandboxMode(session as unknown as DshSession, mode),
    setApprovalPolicy: (session, policy) =>
      setApprovalPolicy(session as unknown as DshSession, policy),
  })
  /** DSH's permission presets while dsh-permission-presets is composed (Workspace grants choose from them). */
  let permissionCatalog: PermissionCatalog | undefined
  ctx.inject(["permissionPresets"], (presetsCtx) => {
    const { permissionPresets } = presetsCtx as unknown as PermissionPresetServices
    presetsCtx.effect(
      () => permissions.attachPresets(permissionPresets),
      "bot-core: permission presets",
    )
    presetsCtx.effect(() => {
      permissionCatalog = permissionPresets
      return () => {
        if (permissionCatalog === permissionPresets) permissionCatalog = undefined
      }
    }, "bot-core: permission presets of Workspace grants")
  })
  /** Bot Agents (isolation's verdict) run under bot-core's permission. */
  const pinPermission = (agent: LiveAgent) => {
    if (isolation.verdict(agent).kind === "bot") permissions.pin(agent.session)
  }
  const repinPermission = (agent: LiveAgent) => {
    try {
      pinPermission(agent)
    } catch (error) {
      warn(`bot-core: could not set the permission of "${agent.id}": ${String(error)}`)
    }
  }

  const placement = createPlacementKeeper<LiveAgent>({
    presetOf,
    sessionBotOf,
    exempt: (agent) => isLegacyMain(agent.id),
    ready: (botId) => realizer.registration(botId) !== undefined,
    select: (agent, presetId) => host.agentPresets.select(agent, presetId),
    label: (agent) => agent.id,
    warn,
  })

  /** Follow the continued questions of a bot session (set while DSH's questions are). */
  let reconcileContinued: (sessionId: string) => void = () => {}

  // Serial: a throw rolls the Agent's creation back (isolation fails closed).
  events.on("agent/created", async ({ agent }: { agent: LiveAgent }) => {
    isolation.created(agent)
    // Not prepended: dsh-permission-presets pins the profile default first.
    pinPermission(agent)
    // A bot's session started elsewhere (a fork in the Web UI, a resume of a
    // session the record does not know yet) is recorded as the bot's. Only a
    // stored bot's; subagents are not navigable sessions.
    const header = agent.session.header
    const botId = botOfPresetId(header.agentPreset, (id) => table.get(id) !== undefined)
    if (
      botId !== undefined &&
      header.origin !== "subagent" &&
      header.parentSession === undefined &&
      !creating.has(agent.id)
    ) {
      registry.adopt(botId, agent.id).catch((error: unknown) => {
        warn(
          `bot-core: could not record session "${agent.id}" as bot "${botId}"'s: ${String(error)}`,
        )
      })
    }
    // A Main's pending model, before its Agent can start a turn (a resume runs the prompt that woke it).
    const mainOf = registry.botOfMain(agent.id)?.id
    if (mainOf !== undefined) {
      const applied = mainModels.apply(mainOf).catch((error: unknown) => {
        warn(`bot-core: could not apply the main model of bot "${mainOf}": ${String(error)}`)
      })
      // A provider that does not answer its model list must not hold the Main's resume.
      await Promise.race([applied, sleep(MAIN_MODEL_WAIT_MS)])
    }
    // After publication: a blank bot session on another preset, and the
    // continued questions of a resumed bot session.
    later(() => {
      placement.check(agent)
      reconcileContinued(agent.id)
    }, 0)
  })
  events.on("tools/change", () => isolation.resync())
  events.on("agent-preset/selected", (sessionId: string) => {
    isolation.resync()
    const agent = host.agents.get(sessionId)
    if (agent === undefined) return
    repinPermission(agent)
    placement.check(agent)
  })
  // Agents that outlived an earlier load of this plugin.
  isolation.resync()
  for (const agent of host.agents.list()) repinPermission(agent)
  for (const botId of botIds()) applyMainModel(botId)

  // A bot Agent's working directory exists only in its environment: DSH's
  // Host working-directory service must not validate it with the Host's file
  // system. Every other Agent passes straight to the Host's own check.
  /**
   * The environment fs of bot `botId` for its Agent: only from a composition
   * of that bot's own preset. An Agent of the bot's session on another preset
   * (locked down; another bot's preset would reach that bot's VM) gets none:
   * `ensure` then answers without I/O and `set` is refused.
   */
  const fsOf = (agent: LiveAgent, botId: string): EnvironmentFs | undefined => {
    const wanted = botPresetId(botId)
    const preset = presetOf(agent)
    if (preset !== undefined) {
      return preset === wanted ? host.agentPresets.serviceFor(agent, "fs") : undefined
    }
    // A subagent not composed yet (DSH sets its directory before it joins
    // its parent's preset): its parent's environment, if the parent runs
    // the bot's preset.
    const parent = parentOf(agent)
    return parent !== undefined && presetOf(parent) === wanted
      ? host.agentPresets.serviceFor(parent, "fs")
      : undefined
  }
  events.on(
    "working-directory/access",
    createWorkingDirectoryAccess<LiveAgent>({
      sessionOf,
      fsOf,
      current: (agent) => services.workingDirectory.get(agent.session),
      original: (agent) => agent.session.header.cwd,
      workspace: () => environments.current()?.workspace,
      commit(agent, directory, notice, signal) {
        // As dsh-working-directory commits: never after an abort, nor on an
        // Agent whose scope is tearing down.
        signal.throwIfAborted()
        agent.ctx.fiber.assertActive()
        agent.session.append("working-directory/change", { cwd: directory })
        try {
          agent.inject(
            createUserMessage({
              content: [{ type: "text", text: notice }],
              source: { kind: "working-directory" },
            }),
          )
        } catch (error) {
          warn(
            `bot-core: committed the working directory ${JSON.stringify(directory)} of "${agent.id}", but could not queue its notice: ${String(error)}`,
          )
        }
      },
    }),
    { prepend: true },
  )

  // A due schedule resumes its session as soon as the Host is up, and the
  // schedule delivers every due task in one queue (its management calls
  // included). So a bot session waits for its bot's preset only within a
  // window after start-up, shared by all of them, never past an unload, and
  // never fails the delivery.
  events.on("schedule/resolve-agent", async (sessionId: string, next: () => Promise<unknown>) => {
    try {
      const remaining = startedAt + RESUME_WAIT_MS - Date.now()
      const botId = remaining > 0 ? registry.botOfSession(sessionId) : undefined
      if (botId !== undefined) {
        const ready = registered
          .catch(() => undefined)
          .then(() => realizer.settled(botId, remaining))
        await Promise.race([ready, sleep(remaining)])
      }
    } catch (error) {
      warn(`bot-core: could not wait for the preset of session "${sessionId}": ${String(error)}`)
    }
    return next()
  })

  // Removals unregister; renames leave the preset as it is (equal digest).
  ctx.effect(
    () =>
      registry.subscribe(() => {
        void realizer.refreshAll()
        // New bots get their environment; deleted ones lose it after their preset.
        void environments.sync()
      }),
    "bot-core: bot preset sync",
  )

  // Mains created before bot presets keep the default preset: locked down, reported, never rebuilt.
  for (const [id, record] of table.entries()) {
    if (record.mainSessionId !== undefined && !mainOnBotPreset(record)) {
      warn(
        `bot-core: the Main session of bot "${record.name}" (${id}) predates bot presets; it runs the deployment's default Agent preset outside the bot's environment, so it is locked down (no tool runs) and cannot be moved onto the bot preset. Sessions started from the bot (Bot.createSession, the bot's New session) use the bot preset.`,
      )
    }
  }

  // Bots stored before Main was created with the bot get one, under their
  // preset; a bot whose preset was not ready is retried when it becomes ready.
  const repair = (ids: Iterable<string>) => {
    registry.repairMains(ids).catch((error: unknown) => {
      warn(`bot-core: could not start a missing Main session: ${String(error)}`)
    })
  }
  const needsMain = (botId: string) => {
    const record = table.get(botId)
    return record !== undefined && record.mainSessionId === undefined
  }
  ctx.effect(
    () =>
      realizer.subscribe((botId) => {
        isolation.resync()
        if (realizer.registration(botId) === undefined) return
        if (needsMain(botId)) repair([botId])
        // Blank sessions of the bot that were switched away before it was ready.
        for (const agent of host.agents.list()) {
          if (sessionBotOf(agent) === botId) placement.check(agent)
        }
      }),
    "bot-core: bot preset changes",
  )
  void registered.then(() =>
    repair(botIds().filter((botId) => realizer.registration(botId) !== undefined)),
  )

  const presetState = (botId: string): BotPresetState | undefined => {
    const state = realizer.state(botId)
    const record = table.get(botId)
    if (state === undefined || record === undefined) return state
    return record.mainSessionId !== undefined && !mainOnBotPreset(record)
      ? { ...state, legacyMain: true }
      : state
  }

  /** Plugins an outside overlay may name: those of registered templates, and the configured ones. */
  const allowedPlugins = () => {
    const names = new Set(config.allowedPlugins)
    for (const template of catalog.list()) pluginNamesOf(template.plugins, names)
    return names
  }
  /** A change from outside: its overlay is parsed as untrusted. */
  const inbound = (change: BotPresetChange): { template?: string; overlay?: BotOverlay } => ({
    ...(change.template === undefined ? {} : { template: change.template }),
    ...(change.overlay === undefined
      ? {}
      : { overlay: parseOverlay(change.overlay, { allowedPlugins: allowedPlugins() }) }),
  })
  const requireRecord = (botId: string): BotRecord => {
    const record = table.get(botId)
    if (record === undefined) throw new Error(`bot "${botId}" does not exist`)
    return record
  }

  const environmentServices = createEnvironmentFilesKeeper<BotEnvironmentServices>()
  /** What the registered revision's files row handed over: the bot's environment services. */
  const environmentOf = (botId: string) => {
    const token = realizer.registration(botId)?.revisionToken
    if (token === undefined) return undefined
    const services = environmentServices.get(botId, token)
    const fs = services?.fs()
    if (services === undefined || fs === undefined) return undefined
    return { fs, subprocess: services.subprocess() }
  }
  const workspaceFiles = createWorkspaceFiles({
    fsOf: (botId) => environmentOf(botId)?.fs as WritableFileSystem | undefined,
    workspace: () => environments.current()?.workspace,
    version: WORKSPACE_FILES_VERSION,
    placed: (botId, version) => registry.hasWorkspaceFiles(botId, version),
    mark: (botId, version) => registry.markWorkspaceFiles(botId, version),
  })
  /** The notes of the bot as the revision of `token` reaches them: that revision's file system. */
  const notesPlaceOf = (botId: string, token: string): NotesPlace | undefined => {
    const fs = environmentServices.get(botId, token)?.fs()
    const workspace = environments.current()?.workspace
    return fs === undefined || workspace === undefined
      ? undefined
      : { fs: fs as NotesFileSystem, workspace }
  }
  const newNoteId = () => uuidv7(Date.now(), randomBytes(10))
  /** The background skill reviews running now, each read as the session it reviews. */
  const reviewSessions = createReviewSessions()
  /** The skill curations running now (docs/specs/bot-skills.md §12). */
  const curatorSessions = createCuratorSessions()
  /** bot-core's records a session's kind is read from (host/prompt/session-kind.ts). */
  const sessionKinds: SessionKindDeps = {
    isMain: (botId, sessionId) => table.get(botId)?.mainSessionId === sessionId,
    isScheduleRun: (botId, sessionId) => scheduleStore.runOfSession(sessionId)?.botId === botId,
    isRecorded: (botId, sessionId) => registry.botOfSession(sessionId) === botId,
    reviewed(botId, sessionId) {
      const review = reviewSessions.get(sessionId)
      return review?.botId === botId ? review.kind : undefined
    },
    curating: (botId, sessionId) => curatorSessions.get(sessionId)?.botId === botId,
    isStartedByMain: (botId, sessionId) =>
      registry.botOfSession(sessionId) === botId && registry.startedByMain(sessionId),
  }
  const botNotes = createBotNotes<LiveAgent>({
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    agent: (agentId) => host.agents.get(agentId),
    botOf: (agent) => sessionBotOf(agent),
    kind: sessionKinds,
    placeOf: notesPlaceOf,
    tools: createNoteTools({ newId: newNoteId }),
    shield: (botId, text) => shieldContext(botId, text),
  })
  ctx.effect(
    () => registry.subscribe(() => botNotes.forget((botId) => table.get(botId) !== undefined)),
    "bot-core: notes of bots",
  )
  const initialNotes = createInitialNotes({
    placeOf(botId) {
      const token = realizer.registration(botId)?.revisionToken
      return token === undefined ? undefined : notesPlaceOf(botId, token)
    },
    withNotes: (botId, work) => botNotes.withNotes(botId, work),
    newId: newNoteId,
    version: INITIAL_NOTES_VERSION,
    placed: (botId, version) => registry.hasInitialNotes(botId, version),
    mark: (botId, version) => registry.markInitialNotes(botId, version),
  })
  /** What a bot gets once: AGENTS.md and SOUL.md in its workspace, and the pinned notes Owner and Now. */
  const initialPlacements = [
    {
      what: "the initial AGENTS.md and SOUL.md",
      placed: (botId: string) => registry.hasWorkspaceFiles(botId, WORKSPACE_FILES_VERSION),
      ensure: (botId: string, signal: AbortSignal) => workspaceFiles.ensure(botId, signal),
    },
    {
      what: "the initial notes Owner and Now",
      placed: (botId: string) => registry.hasInitialNotes(botId, INITIAL_NOTES_VERSION),
      ensure: (botId: string, signal: AbortSignal) => initialNotes.ensure(botId, signal),
    },
  ] as const
  /** Place what the bot has not got yet; a failure is reported and tried again at the next attach. */
  const placeWorkspaceFiles = async (botId: string) => {
    const signal = AbortSignal.timeout(WORKSPACE_FILES_TIMEOUT_MS)
    for (const placement of initialPlacements) {
      await placement.ensure(botId, signal).catch((error: unknown) => {
        warn(`bot-core: could not place ${placement.what} of bot "${botId}": ${String(error)}`)
      })
    }
  }
  /**
   * Bots stored before these existed get them once their registered
   * revision's file system is attached; whichever of the registration and the
   * attachment comes last finds both.
   */
  const placeMissingWorkspaceFiles = (botId: string) => {
    if (table.get(botId)?.mainSessionId === undefined) return
    if (initialPlacements.every((placement) => placement.placed(botId))) return
    if (environmentOf(botId) === undefined) return
    void placeWorkspaceFiles(botId)
  }
  ctx.effect(
    () => environmentServices.subscribe(placeMissingWorkspaceFiles),
    "bot-core: initial workspace files (attached file systems)",
  )
  ctx.effect(
    () => realizer.subscribe(placeMissingWorkspaceFiles),
    "bot-core: initial workspace files (registered presets)",
  )
  ctx.effect(
    () => environments.subscribe(placeMissingWorkspaceFiles),
    "bot-core: initial workspace files (environment changes)",
  )
  const files = createBotFiles({
    botOfSession(sessionId) {
      const botId = registry.botOfSession(sessionId)
      // A deleted bot's sessions are no longer answered.
      return botId !== undefined && table.get(botId) !== undefined ? botId : undefined
    },
    environmentOf(botId) {
      const environment = environmentOf(botId)
      return environment === undefined
        ? undefined
        : {
            fs: environment.fs as EnvironmentFileSystem,
            subprocess: environment.subprocess as EnvironmentSubprocess | undefined,
          }
    },
    workspace: () => environments.current()?.workspace,
    limits: config.files,
    deadline: (ms) => AbortSignal.timeout(ms),
    warn,
  })
  registerRemoteContract(services.typert)
  new BotFilesRemoteService(ctx, files)
  const notesPanel = createNotesPanel({
    botOfSession(sessionId) {
      const botId = registry.botOfSession(sessionId)
      return botId !== undefined && table.get(botId) !== undefined ? botId : undefined
    },
    placeOf(botId) {
      const token = realizer.registration(botId)?.revisionToken
      return token === undefined ? undefined : notesPlaceOf(botId, token)
    },
    notes: botNotes,
    timeZone: (botId) => registry.timezoneOf(botId),
    today: (botId) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: registry.timezoneOf(botId),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(Date.now()),
    deadline: () => AbortSignal.any([AbortSignal.timeout(NOTES_READ_LIMIT_MS), unload.signal]),
  })
  ctx.effect(() => () => notesPanel.dispose(), "bot-core: notes panel")
  for (const source of [environmentServices, realizer, environments]) {
    ctx.effect(
      () => source.subscribe((botId: string) => notesPanel.environmentChanged(botId)),
      "bot-core: notes panel (environment changes)",
    )
  }
  new BotNotesRemoteService(ctx, notesPanel)
  new BotWebRemoteService(
    ctx,
    createWebPanel({
      state: webState,
      store: webStore,
      tester: createWebTester({ deadline: (ms) => AbortSignal.timeout(ms) }),
    }),
    (listener) => webState.subscribe(listener),
  )

  // Channels' outputs (replies, turns, files, interactions) for every bot's
  // connections; the connections themselves are kept below, with the settings.
  const channelCatalog = createChannelCatalog()
  // The channels the welcome guide sets up for its bot, through the channels' panel (below).
  const welcomeChannels = createWelcomeChannels({ catalog: channelCatalog })
  ctx.effect(() => () => welcomeChannels.dispose(), "bot-core: the welcome guide's channels")
  /** Tell the managed sessions an interaction opened (set once they are wired, below). */
  let interactionOpened: (sessionId: string, interaction: BotInteraction) => void = () => {}
  /** The bot managing a Workspace session (set once managed sessions are wired, below). */
  let managedWorkspaceBot: (sessionId: string) => string | undefined = () => undefined
  /** The bot whose Main answers a managed Workspace session's questions (set below). */
  let mainAnsweredWorkspace: (sessionId: string) => string | undefined = () => undefined
  /** Follows what DSH's own UI holds in managed Workspace sessions (set below). */
  let dshWaits: {
    question(
      request: DshQuestionRequest<LiveAgent>,
      next: () => Promise<DshQuestionAnswer>,
    ): Promise<DshQuestionAnswer>
    approval(
      request: DshApprovalRequest<LiveAgent>,
      next: () => Promise<DshApprovalOutcome>,
    ): Promise<DshApprovalOutcome>
  } = { question: (_request, next) => next(), approval: (_request, next) => next() }
  // Questions, approvals and plan reviews of bot sessions: bot-core answers
  // DSH's waterfalls for bot Agents itself (README, "Interactions").
  const interactions = createInteractionBoard({
    newId: () => randomUUID().replaceAll("-", "").slice(0, 10),
    publish: (botId, output) => outlets.publish(botId, output),
    opened: (place, interaction) => interactionOpened(place.sessionId, interaction),
  })
  const placeOfRoot = (agent: LiveAgent): InteractionPlace | undefined => {
    const botId = sessionBotOf(agent)
    if (botId === undefined || agent.session.header.origin === "subagent") return undefined
    return { botId, sessionId: agent.id, main: table.get(botId)?.mainSessionId === agent.id }
  }
  /** Where a question waits on bot-core's board: a bot's session, or a Workspace session its Main answers. */
  const placeOfQuestion = (agent: LiveAgent): InteractionPlace | undefined => {
    const place = placeOfRoot(agent)
    if (place !== undefined || agent.session.header.origin === "subagent") return place
    const botId = mainAnsweredWorkspace(agent.id)
    return botId === undefined ? undefined : { botId, sessionId: agent.id, main: false }
  }
  const approvals = createApprovalAnswerer<LiveAgent>({
    board: interactions,
    place(agent) {
      let root = agent
      for (let depth = 0; root.session.header.origin === "subagent"; depth += 1) {
        const parent = parentOf(root)
        if (parent === undefined || depth >= MAX_DELEGATION_DEPTH) return undefined
        root = parent
      }
      const place = placeOfRoot(root)
      return place === undefined || sessionBotOf(agent) !== place.botId
        ? undefined
        : { place, delegated: root !== agent }
    },
  })
  events.on(
    "approval/request",
    (request: DshApprovalRequest<LiveAgent>, next: () => Promise<DshApprovalOutcome>) =>
      approvals.answer(request, () => dshWaits.approval(request, next)),
    { prepend: true },
  )
  ctx.inject(["userQuestions", "sessionProjections"], (questionsCtx) => {
    const dsh = questionsCtx as unknown as UserQuestionsServices
    const tracker = createContinuedQuestions({
      board: interactions,
      placeOf(sessionId) {
        const agent = host.agents.get(sessionId)
        return agent === undefined ? undefined : placeOfQuestion(agent)
      },
      rows(sessionId) {
        const agent = host.agents.get(sessionId)
        if (agent === undefined) return undefined
        return dsh.sessionProjections.snapshot(agent.session, ["userQuestions"]).values
          .userQuestions?.active
      },
      async reply(sessionId, callId, answer) {
        const resolved = await services.sessionController.resolveAgent(sessionId)
        if ("error" in resolved) throw resolved.error
        const agent = host.agents.get(sessionId)
        if (agent === undefined) throw new Error("the bot session could not be resumed")
        return dsh.userQuestions.answer(agent, callId, answer)
      },
    })
    const claims = new AbortController()
    const questions = createQuestionAnswerer<LiveAgent>({
      board: interactions,
      continued: tracker,
      place: placeOfQuestion,
      async claim(agent, callId) {
        const iterator = dsh.userQuestions
          .attachWait(agent, callId, claims.signal)
          [Symbol.asyncIterator]()
        const first = await iterator.next()
        if (first.done === true) return undefined
        return {
          remainingMs: first.value.remainingMs,
          release: () => {
            iterator.return?.().catch((error: unknown) => {
              warn(`bot-core: could not release a question's wait: ${String(error)}`)
            })
          },
        }
      },
      now: Date.now,
      later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    })
    questionsCtx.effect(
      () => () => {
        questions.delegateAll()
        claims.abort()
      },
      "bot-core: DSH's questions",
    )
    const questionEvents = questionsCtx as unknown as HostEvents
    questionEvents.on(
      "user-questions/request",
      (request: DshQuestionRequest<LiveAgent>, next: () => Promise<DshQuestionAnswer>) =>
        questions.answer(request, () => dshWaits.question(request, next)),
      { prepend: true },
    )
    questionsCtx.effect(
      () =>
        dsh.sessionProjections.onChanged((session, key) => {
          if (key === "userQuestions") tracker.reconcile(session.id)
        }),
      "bot-core: continued questions",
    )
    questionEvents.on(
      "agent/inbox/discarded",
      ({
        agent,
        message,
      }: {
        agent: LiveAgent
        message: { source: { kind: string; callId?: string } }
      }) => {
        const { source } = message
        if (source.kind === "user-question-reply" && source.callId !== undefined) {
          tracker.released(agent.id, source.callId)
        }
      },
    )
    questionsCtx.effect(() => {
      reconcileContinued = (sessionId) => tracker.reconcile(sessionId)
      return () => {
        reconcileContinued = () => {}
      }
    }, "bot-core: continued questions of resumed sessions")
    for (const agent of host.agents.list()) tracker.reconcile(agent.id)
  })
  new BotInteractionsRemoteService(
    ctx,
    createInteractionPanel({
      board: interactions,
      isBotSession(sessionId) {
        const botId = registry.botOfSession(sessionId) ?? managedWorkspaceBot(sessionId)
        return botId !== undefined && table.get(botId) !== undefined
      },
      channelName: (channelId) => channelCatalog.get(channelId)?.name,
      now: Date.now,
    }),
    (listener) => interactions.subscribe(listener),
  )
  const mainSessionRefusal =
    (tool: string) =>
    (botId: string, token: string, agentId: string): string | undefined => {
      if (realizer.registration(botId)?.revisionToken !== token) {
        return "this preset revision of the bot is no longer the registered one; start a new turn"
      }
      const agent = host.agents.get(agentId)
      if (agent === undefined || sessionBotOf(agent) !== botId) {
        return `${tool} runs only in a session of this bot`
      }
      if (table.get(botId)?.mainSessionId !== agentId) {
        return `${tool} works only in the bot's Main session, the conversation its channels are connected to (not in other sessions or subagents)`
      }
      return undefined
    }
  const turnSilence = createTurnSilence()
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    const boundary = turnBoundaryOf(event)
    if (boundary !== undefined) turnSilence.follow(session.id, boundary)
  })
  const silencer = createSilencer({
    refusal: mainSessionRefusal("stay_silent"),
    silence: turnSilence,
  })
  // Connectors: their tools run on the Host; `ask` calls become actions in
  // the ledger, decided later; ended ones reach the Main session through the
  // notice outbox (README, "Connectors").
  const noticesDomain = await services.storageDomain.open(NOTICES_DOMAIN)
  ctx.effect(() => () => void noticesDomain.close(), "bot-core: notices storage domain")
  let imageServices: () => ImageServices | undefined = () => undefined
  let imageReads: AttachmentReads["attachments"] | undefined
  ctx.inject(["attachments"], (readsCtx) => {
    const { attachments } = readsCtx as unknown as AttachmentReads
    readsCtx.effect(() => {
      imageReads = attachments
      return () => {
        imageReads = undefined
      }
    }, "bot-core: images of the Main view")
  })
  ctx.inject(["attachments", "llm"], (imagesCtx) => {
    const dsh = imagesCtx as unknown as ImageServices
    imagesCtx.effect(() => {
      imageServices = () => ({ attachments: dsh.attachments, llm: dsh.llm })
      return () => {
        imageServices = () => undefined
      }
    }, "bot-core: images of connector results")
  })
  /** Ensures that resolved per bot: a connector prepares the environment again after each. */
  const environmentGenerations = new Map<string, number>()
  const environmentState = (botId: string): EnvironmentState => {
    const status = environments.status(botId)
    if (!status.ready) return { ready: false, reason: status.problem }
    const token = realizer.registration(botId)?.revisionToken
    const ensured = environments.ensured(botId)
    if (token === undefined || ensured === undefined || environmentOf(botId) === undefined) {
      return { ready: false, reason: "the bot's preset is not registered yet" }
    }
    return {
      ready: true,
      generation: `${token}:${environmentGenerations.get(botId) ?? 0}`,
    }
  }
  const connectorEnvironment = (botId: string) =>
    createConnectorEnvironment({
      access() {
        const subprocess = environmentOf(botId)?.subprocess
        const workspace = environments.current()?.workspace
        return subprocess === undefined || workspace === undefined
          ? undefined
          : { subprocess: subprocess as ConnectorSubprocess, workspace }
      },
      workspace: environments.current()?.workspace ?? "",
      deadline: (ms) => AbortSignal.timeout(ms),
    })
  const botOfRecord = (botId: string) => {
    const record = table.get(botId)
    return record === undefined ? undefined : { id: botId, name: record.name }
  }
  const attachments = createConnectorAttachments({ warn })
  const statuses = createConnectorStatuses({
    catalog: connectorCatalog,
    settings: connectorSettings,
    warn,
  })
  const connectorRuns = createConnectorRuns({
    bot: botOfRecord,
    settings: connectorSettings,
    environment: connectorEnvironment,
    attachments,
    images: (sessionId, signal) =>
      createRunImages(
        {
          services: () => imageServices(),
          route(agentId) {
            const current = host.agents.get(agentId)?.model.current()
            return current === undefined
              ? undefined
              : { provider: current.provider, model: current.model }
          },
          newId: () => `img-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        },
        sessionId,
        signal,
      ),
    connection: connectionOf,
    vault: (context) => vaultAccess.forRun(context),
  })
  const readiness = createConnectorReadiness({
    catalog: connectorCatalog,
    settings: connectorSettings,
    bots: botIds,
    exists: (botId) => table.get(botId) !== undefined,
    environment: environmentState,
    accounts: (botId, connector) => connectorAccounts.problem(botId, connector),
    context: (botId, connector, signal) => connectorRuns.context(botId, connector, signal),
    now: Date.now,
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    warn,
  })
  /**
   * Ensure the bot again when its environment runs with another spec than the
   * stored one; a bot whose ensure failed is tried again at once, so a
   * corrected spec does not wait for the backoff.
   */
  const applySpec = (botId: string) => {
    const spec = specStore.get(botId)
    if (spec === undefined) return
    const status = environments.status(botId)
    if (!status.ready && status.pending !== true) {
      environments.retry(botId)
      return
    }
    const ensured = environments.ensured(botId)
    if (ensured !== undefined && !sameEnvironmentSpec(ensured.spec, spec))
      environments.reconcile(botId)
  }
  const connectorStreams = createConnectorStreams({
    catalog: connectorCatalog,
    readiness,
    exists: (botId) => table.get(botId) !== undefined,
    context: (botId, connector, signal) => connectorRuns.context(botId, connector, signal),
  })
  ctx.effect(() => {
    const offs = [
      environments.subscribe((botId) => {
        if (environments.status(botId).ready) {
          environmentGenerations.set(botId, (environmentGenerations.get(botId) ?? 0) + 1)
          // A spec saved while the environment was being ensured needs it ensured again.
          applySpec(botId)
        }
        readiness.sync(botId)
      }),
      environmentServices.subscribe((botId) => readiness.sync(botId)),
      realizer.subscribe((botId) => readiness.sync(botId)),
      connectorCatalog.subscribe(() => readiness.sync()),
      connectorSettings.subscribe((botId) => readiness.sync(botId)),
      specStore.subscribe(applySpec),
      readiness.subscribe((botId, connectorId) => {
        if (readiness.state(botId, connectorId).state !== "ready") {
          attachments.release(botId, connectorId)
          connectorStreams.release(botId, connectorId)
        }
      }),
      connectionStore.subscribe(() => readiness.sync()),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, "bot-core: connector readiness")
  const ledger = createConnectorLedger({ actions: connectorsDomain.table("actions"), warn })
  const outbox = createNoticeOutbox({
    notices: noticesDomain.table("notices"),
    shield: (botId, notice) => shieldContext(botId, notice),
    newId: () => randomUUID(),
    now: Date.now,
  })
  const broker = createConnectorBroker({
    catalog: connectorCatalog,
    shield: (botId, tool, value) => shieldContext(botId, value, tool),
    permissions: connectorPermissions,
    ledger,
    deadlines: createDeadlines({
      later: (ms, work) => later(work, ms),
      now: Date.now,
      maxDelayMs: MAX_TIMER_MS,
    }),
    readiness,
    runs: connectorRuns,
    accounts: connectorAccounts,
    exclusive: createExclusiveRuns(),
    operated: (botId, connector) =>
      operatedRequirement(connector, {
        get: (id) => connectorCatalog.get(id),
        status: (required) => statuses.read(botId, required),
      }),
    async notify(botId, notice) {
      await outbox.enqueue(botId, "connector", notice)
    },
    newId: () => `act-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    now: Date.now,
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    retentionMs: CONNECTOR_RETENTION_MS,
    warn,
  })
  // Skills: the bot's skills/, skill_manage, their history and the background review (docs/specs/bot-skills.md).
  const skillsDomain = await services.storageDomain.open(SKILLS_DOMAIN)
  ctx.effect(() => () => void skillsDomain.close(), "bot-core: skills storage domain")
  const skillStore = createSkillStore({
    skillHistory: skillsDomain.table("history"),
    skillUsage: skillsDomain.table("usage"),
    skillSettings: skillsDomain.table("settings"),
    skillMarks: skillsDomain.table("marks"),
    skillCuration: skillsDomain.table("curation"),
  })
  /** The skills of the bot as the revision of `token` reaches them: that revision's file system. */
  const skillsPlaceOf = (botId: string, token: string): SkillsPlace | undefined => {
    const fs = environmentServices.get(botId, token)?.fs()
    const workspace = environments.current()?.workspace
    return fs === undefined || workspace === undefined
      ? undefined
      : { fs: fs as SkillsFileSystem, workspace }
  }
  const registeredSkillsPlace = (botId: string) => {
    const token = realizer.registration(botId)?.revisionToken
    return token === undefined ? undefined : skillsPlaceOf(botId, token)
  }
  const dayIn = (botId: string, at: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: registry.timezoneOf(botId),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at)
  /** The kind of a bot's session that a review may run for: a Main or Web session that is no review itself. */
  const reviewableKind = (botId: string, sessionId: string): "main" | "web" | undefined => {
    if (reviewSessions.get(sessionId) !== undefined || curatorSessions.get(sessionId) !== undefined)
      return undefined
    const agent = host.agents.get(sessionId)
    if (agent === undefined || sessionBotOf(agent) !== botId) return undefined
    try {
      const kind = sessionKindOf(sessionKinds, botId, agent)
      return kind === "main" || kind === "web" ? kind : undefined
    } catch {
      return undefined
    }
  }
  /** A review's Agent: the session's completed turns on its preset and route; only skill_manage runs. */
  const createReviewAgent = async (request: ReviewAgentRequest) => {
    const { route } = request
    const selection = {
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
    }
    const handle = await host.agents.create({
      sessionId: request.reviewId,
      agentOptions: { ...selection },
      meta: {
        cwd: request.cwd,
        agentPreset: request.agentPreset,
        parentSession: request.parentSession,
        isSeeded: true,
        origin: "subagent",
      },
      seed: request.seed,
      inheritedEventCount: request.seed.length,
      async setup(agentCtx, created) {
        installModelSelection(agentCtx)
        created.model.select(selection)
        ;(agentCtx as unknown as ScopedTools).tools.guard((execution) =>
          execution.name === SKILL_MANAGE_TOOL ? undefined : REVIEW_REFUSAL,
        )
        await host.agentPresets.mount(agentCtx, request.agentPreset)
      },
    })
    return {
      prompt(text: string, summary: string) {
        host.agents.withoutInitiator(() =>
          handle.agent.followup(
            createUserMessage({
              content: [{ type: "text", text }],
              source: { kind: "bot-skills", form: "notice", summary },
            }),
          ),
        )
      },
      dispose: () => handle.dispose(),
    }
  }
  const reviewRunner = createReviewRunner({
    source: (sessionId) => host.agents.get(sessionId),
    kind: reviewableKind,
    reviews: reviewSessions,
    newId: () => `session-${randomUUID()}`,
    create: createReviewAgent,
    later: (ms, work) => later(work, ms),
    limitMs: SKILL_REVIEW_LIMIT_MS,
  })
  const skillReviews = createSkillReviews({
    enabled: (botId) => skillStore.reviewEnabled(botId),
    idle(sessionId) {
      const agent = host.agents.get(sessionId)
      return (
        agent !== undefined &&
        agent.status === "idle" &&
        agent.inbox.nextTurn.length === 0 &&
        agent.inbox.nextStep.length === 0
      )
    },
    run: (botId, sessionId) => reviewRunner.run(botId, sessionId),
    later: (ms, work) => later(work, ms),
    warn,
  })
  ctx.effect(() => () => skillReviews.dispose(), "bot-core: skill reviews")
  const botSkills = createBotSkills<LiveAgent>({
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    agent: (agentId) => host.agents.get(agentId),
    botOf: sessionBotOf,
    kind: sessionKinds,
    reviews: reviewSessions,
    placeOf: skillsPlaceOf,
    shield: (botId, value) => shieldContext(botId, value),
    history: {
      store: skillStore,
      newId: () => uuidv7(Date.now(), randomBytes(10)),
      now: Date.now,
      day: dayIn,
    },
    store: skillStore,
    stepped: (botId, sessionId) => skillReviews.stepped(botId, sessionId),
    now: Date.now,
    warn,
  })
  ctx.effect(
    () => registry.subscribe(() => botSkills.forget((botId) => table.get(botId) !== undefined)),
    "bot-core: skills of bots",
  )
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    reviewRunner.sessionEvent(session.id, event)
    if (event.type !== "turn/end") return
    const agent = host.agents.get(session.id)
    const botId = agent === undefined ? undefined : sessionBotOf(agent)
    if (botId !== undefined && reviewableKind(botId, session.id) !== undefined) {
      skillReviews.turnEnded(botId, session.id)
    }
  })
  events.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => {
    if (status === "running") skillReviews.busy(agent.id)
  })
  /** The texts of a bot's armed schedule jobs, where a skill they need is named. */
  const scheduledTexts = (botId: string) =>
    scheduleStore
      .jobs(botId)
      .filter(isArmed)
      .flatMap((job) => [job.instruction, ...(job.check === undefined ? [] : [job.check.command])])
  const skillRetentions = createSkillRetentions({ store: skillStore, jobTexts: scheduledTexts })
  const skillPanel = createSkillPanel({
    skills: botSkills,
    store: skillStore,
    retentions: skillRetentions,
    placeOf: registeredSkillsPlace,
    exists: (botId) => table.get(botId) !== undefined,
    deadline: () => AbortSignal.any([AbortSignal.timeout(SKILL_READ_LIMIT_MS), unload.signal]),
  })
  ctx.effect(() => () => skillPanel.dispose(), "bot-core: skills panel")
  new BotSkillsRemoteService(ctx, skillPanel)
  /** A review's tool list is the reviewed session's, so its request reuses that session's cached prefix. */
  const shownAs = (agentId: string) => reviewSessions.get(agentId)?.sessionId ?? agentId

  // Main sessions: idle compaction and new Mains (docs/specs/bot-main-rotation.md).
  const mainsDomain = await services.storageDomain.open(MAINS_DOMAIN)
  ctx.effect(() => () => void mainsDomain.close(), "bot-core: Main sessions storage domain")
  const mainStore = await openMainStore({
    mainSettings: mainsDomain.table("settings"),
    mainOverrides: mainsDomain.table("overrides"),
    mainActivity: mainsDomain.table("activity"),
  })
  let tokenMeter: TokenMeterServices["tokenMeter"] | undefined
  ctx.inject(["tokenMeter"], (meterCtx) => {
    const meter = (meterCtx as unknown as TokenMeterServices).tokenMeter
    meterCtx.effect(() => {
      tokenMeter = meter
      return () => {
        tokenMeter = undefined
      }
    }, "bot-core: token meter of Main sessions")
  })
  const mainStateOf = (agent: LiveAgent) => ({
    status: agent.status,
    inboxEmpty: agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0,
    usagePercent:
      tokenMeter === undefined
        ? undefined
        : usagePercentOf(tokenMeter.contextPressure(agent.session)),
  })
  const liveAgentOf = async (sessionId: string): Promise<LiveAgent> => {
    const resolved = await services.sessionController.resolveAgent(sessionId)
    if ("error" in resolved) throw resolved.error
    const agent = host.agents.get(sessionId)
    if (agent === undefined) throw new Error(`the session "${sessionId}" has no live Agent`)
    return agent
  }
  const mainBotOf = (botId: string) => {
    const bot = registry.get(botId)
    return bot === undefined
      ? undefined
      : { id: bot.id, name: bot.name, timezone: bot.timezone, mainSessionId: bot.mainSessionId }
  }
  /** One maintenance turn of a Main (host/mains/turns.ts): its outputs stay off the channels. */
  const runMaintenanceTurn = async (sessionId: string, prompt: MainTurnPrompt) => {
    const ended = maintenanceTurns.expect(sessionId)
    try {
      const agent = await liveAgentOf(sessionId)
      host.agents.withoutInitiator(() =>
        agent.followup(
          createUserMessage({
            content: [{ type: "text", text: prompt.text }],
            source: { kind: "bot-main", form: "notice", summary: prompt.summary },
          }),
        ),
      )
    } catch (error) {
      maintenanceTurns.abandon(sessionId, String(error))
    }
    return ended
  }
  const compactors = createCompactorKeeper()
  const mainPreparations = createMainPreparations()
  ctx.effect(
    () =>
      mainPreparations.register(
        createMemoryFlush({
          enabled: (botId) =>
            effectiveMainRotation(mainStore.defaults(), mainStore.override(botId)).memoryFlush
              .enabled,
        }),
      ),
    "bot-core: memory write-out before Main maintenance",
  )
  const maintenanceTurns = createMaintenanceTurns()
  const mains = createMainController({
    bot: mainBotOf,
    bots: () => registry.list().flatMap((bot) => mainBotOf(bot.id) ?? []),
    store: mainStore,
    agentOf(sessionId) {
      const agent = host.agents.get(sessionId)
      return agent === undefined ? undefined : mainStateOf(agent)
    },
    resolve: async (sessionId) => mainStateOf(await liveAgentOf(sessionId)),
    openInteractions: (botId) => interactions.mainOf(botId).length,
    async compact(botId, sessionId, signal) {
      const agent = await liveAgentOf(sessionId)
      const token = realizer.registration(botId)?.revisionToken
      const compactor = token === undefined ? undefined : compactors.get(botId, token)
      if (compactor === undefined)
        throw new Error("the bot's registered preset holds no compaction")
      return compactor.compactNow(agent, signal)
    },
    createMain: (botId, title) => createMainSession({ id: botId, name: title }),
    async replaceMain(botId, expected, next, reason) {
      await registry.replaceMain(botId, expected, next, reason)
      // A main change made while the new Main was being created.
      applyMainModel(botId)
    },
    archive: (sessionId) =>
      services.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }),
    mainChanged: (botId) => delivery.mainChanged(botId),
    preparations: mainPreparations,
    runTurn: runMaintenanceTurn,
    now: Date.now,
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    deadline: (ms) => AbortSignal.any([AbortSignal.timeout(ms), unload.signal]),
    notReady: (error) => error instanceof BotPresetNotReadyError,
    maintenanceLimitMs: MAIN_MAINTENANCE_LIMIT_MS,
    retry: MAIN_MAINTENANCE_RETRY,
    warn,
  })
  ctx.effect(() => () => mains.dispose(), "bot-core: Main sessions")
  events.on("session/event", (session: LiveAgent["session"], event: SessionEventLike) => {
    maintenanceTurns.follow(session.id, event)
    if (event.type !== "turn/end" && event.type !== "compaction/end") return
    if (registry.botOfMain(session.id) === undefined) return
    mains.compactionsCounted(session.id, countCompactions(session.ownEvents()))
    if (event.type === "turn/end" && !maintenanceTurns.belongs(session.id, event)) {
      mains.turnEnded(session.id, Date.now())
    }
  })
  events.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => {
    if (status !== "idle") return
    maintenanceTurns.idled(agent.id)
    const bot = registry.botOfMain(agent.id)
    if (bot !== undefined) mains.poke(bot.id)
  })
  ctx.effect(() => interactions.subscribe(() => mains.pokeAll()), "bot-core: Main interactions")
  ctx.effect(() => registry.subscribe(() => mains.pokeAll()), "bot-core: Mains of bots")
  const mainPanel = createMainPanel({
    store: mainStore,
    controller: mains,
    main(botId) {
      const bot = registry.get(botId)
      return bot === undefined
        ? undefined
        : { sessionId: bot.mainSessionId, startedAt: bot.mainStartedAt }
    },
  })
  new BotMainsRemoteService(ctx, mainPanel, (listener) => {
    const offs = [
      mainStore.subscribe(() => listener()),
      mains.subscribe(() => listener()),
      registry.subscribe(listener),
    ]
    return () => {
      for (const off of offs) off()
    }
  })

  const delivery = createNoticeDelivery({
    outbox,
    admit: (botId, work) => mains.admit(botId, work),
    archived: (sessionId) => services.workspaceRegistry.archivedSessionIds.includes(sessionId),
    ready: (botId) =>
      registered.catch(() => undefined).then(() => realizer.settled(botId, NOTICE_READY_WAIT_MS)),
    async resolve(sessionId) {
      const resolved = await services.sessionController.resolveAgent(sessionId)
      if ("error" in resolved) throw resolved.error
      const agent = host.agents.get(sessionId)
      if (agent === undefined) throw new Error(`the session "${sessionId}" has no live Agent`)
      return noticeAgentOf(agent)
    },
    hand: (work) => host.agents.withoutInitiator(work),
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    retry: NOTICE_RETRY,
    warn,
  })
  ctx.effect(
    () => async () => {
      broker.dispose()
      delivery.dispose()
      readiness.dispose()
      connectorStreams.dispose()
      statuses.dispose()
      await attachments.dispose()
    },
    "bot-core: connector actions and notices",
  )

  // Connectors' events: polled per account on the Host, stored per bot, told
  // to the Main session or kept for the bot to list (README, "Connector events").
  const eventsDomain = await services.storageDomain.open(EVENTS_DOMAIN)
  ctx.effect(() => () => void eventsDomain.close(), "bot-core: connector events storage domain")
  const eventStore = createEventStore({
    events: eventsDomain.table("events"),
    cursors: eventsDomain.table("cursors"),
    newId: () => `evt-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    now: Date.now,
    maxPerStream: EVENTS_PER_STREAM,
    retentionMs: EVENT_RETENTION_MS,
    unreadRetentionMs: UNREAD_EVENT_RETENTION_MS,
  })
  const eventSubscribers = (connectionId: string, connector: { readonly id: string }) =>
    botIds().filter(
      (botId) =>
        connectionStore.isAssigned(botId, connectionId) &&
        connectorSettings.delivery(botId, connector.id) !== "off",
    )
  const eventPoller = createEventPoller({
    catalog: connectorCatalog,
    connections: connectionStore,
    subscribers: eventSubscribers,
    store: eventStore,
    shield: (botId, events) => shieldContext(botId, events),
    connection: connectionOf,
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    deadline: (ms) => AbortSignal.timeout(ms),
    now: Date.now,
    warn,
  })
  const eventDelivery = createEventDelivery({
    store: eventStore,
    delivery: (botId, connectorId) => connectorSettings.delivery(botId, connectorId),
    connectors: () =>
      connectorCatalog
        .list()
        .filter((connector) => connector.events !== undefined)
        .map((connector) => ({ id: connector.id, name: connector.name })),
    account: accountName,
    async enqueue(botId, notice) {
      await outbox.enqueue(botId, "event", notice)
    },
    newNonce: () => randomBytes(8).toString("hex"),
    later: (ms, work) => later(work, ms),
    batchMs: EVENT_BATCH_MS,
    warn,
  })
  const pruneEvents = () =>
    Promise.all([
      eventStore.prune(
        (botId, connectorId, connectionId) =>
          table.get(botId) !== undefined &&
          connectionStore.isAssigned(botId, connectionId) &&
          (connectorCatalog.get(connectorId) === undefined ||
            connectorSettings.delivery(botId, connectorId) !== "off"),
      ),
      eventStore.pruneCursors((connectionId) => connectionStore.get(connectionId) !== undefined),
      connectorPermissions.purge(
        (botId) => table.get(botId) !== undefined,
        (botId, connectionId) => connectionStore.isAssigned(botId, connectionId),
      ),
    ]).catch((error: unknown) => {
      warn(`bot-core: could not forget the events of removed accounts: ${String(error)}`)
    })
  const pruneEventsLater = (): void => {
    later(() => {
      void pruneEvents()
      pruneEventsLater()
    }, EVENT_PRUNE_EVERY_MS)
  }
  ctx.effect(() => {
    const offs = [
      connectorCatalog.subscribe(() => eventPoller.sync()),
      connectionStore.subscribe(() => {
        eventPoller.sync()
        void pruneEvents()
      }),
      connectorSettings.subscribe((botId) => {
        eventPoller.sync()
        eventDelivery.sync(botId)
        void pruneEvents()
      }),
      registry.subscribe(() => eventPoller.sync()),
      connectionProviders.subscribe(() => {
        for (const provider of connectionProviders.list()) {
          if (credentialRecords !== undefined) void oauthClients.load(provider.id)
        }
      }),
    ]
    return () => {
      for (const off of offs) off()
      eventPoller.dispose()
      eventDelivery.dispose()
    }
  }, "bot-core: connector events")
  const connectionSignIn = createConnectionSignIn({
    providers: connectionProviders,
    services: connectionServices,
    store: connectionStore,
    vault: connectionVault,
    tokens: connectionTokens,
    client: (provider) => oauthClients.credentials(provider),
    exists: (botId) => table.get(botId) !== undefined,
    fetch: oauthFetch,
    secret: () => randomBytes(32).toString("base64url"),
    challenge: (verifier) => createHash("sha256").update(verifier).digest("base64url"),
    newConnectionId: () => `conn-${randomBytes(6).toString("hex")}`,
    newAttemptId: () => `att-${randomBytes(6).toString("hex")}`,
    now: Date.now,
    later: (ms, work) => later(work, ms),
    deadline: (ms) => AbortSignal.timeout(ms),
  })
  ctx.effect(() => () => connectionSignIn.dispose(), "bot-core: sign-in attempts")
  new BotConnectionsRemoteService(
    ctx,
    createConnectionPanel({
      providers: connectionProviders,
      services: connectionServices,
      store: connectionStore,
      clients: oauthClients,
      signIn: connectionSignIn,
      vault: connectionVault,
      tokens: connectionTokens,
      fetch: oauthFetch,
      deadline: (ms) => AbortSignal.timeout(ms),
      exists: (botId) => table.get(botId) !== undefined,
    }),
  )
  ctx.inject(["webServer"], (webCtx) => {
    const { webServer } = webCtx as unknown as WebServerServices
    webCtx.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: CONNECTION_CALLBACK_PATH,
          async resource(request) {
            if (request.method !== "GET")
              return new Response(null, { status: 204, headers: CALLBACK_HEADERS })
            const outcome = await connectionSignIn.callback(new URL(request.url).searchParams)
            const page = outcome.ok
              ? callbackPage(
                  `${outcome.provider} account connected`,
                  `${connectionName(outcome.connection)} is connected to DeepSeek Harness. You can close this tab.`,
                )
              : callbackPage("Sign-in failed", outcome.reason)
            return new Response(page, {
              status: outcome.ok ? 200 : outcome.status,
              headers: CALLBACK_HEADERS,
            })
          },
        }),
      "bot-core: OAuth callback route",
    )
  })

  // Schedules: each bot's jobs, run on time; what a run finds reaches the
  // bot's Main session through the notice outbox (README, "Schedules").
  const schedulesDomain = await services.storageDomain.open(SCHEDULES_DOMAIN)
  ctx.effect(() => () => void schedulesDomain.close(), "bot-core: schedules storage domain")
  const scheduleStore = createScheduleStore({
    jobs: schedulesDomain.table("jobs"),
    runs: schedulesDomain.table("runs"),
    keepRuns: SCHEDULE_RUNS_KEPT,
  })
  const scheduleRunner = createScheduleRunner({
    store: scheduleStore,
    check: createCheckRunner({
      environmentOf(botId) {
        const subprocess = environmentOf(botId)?.subprocess
        const workspace = environments.current()?.workspace
        return subprocess === undefined || workspace === undefined
          ? undefined
          : { subprocess: subprocess as EnvironmentWriteSubprocess, workspace }
      },
      deadline: (ms) => AbortSignal.timeout(ms),
    }),
    async notify(botId, notice) {
      await outbox.enqueue(botId, "schedule", notice)
    },
    openSession: async (botId, title) => (await sessions.create(botId, { title })).sessionId,
    async prompt(sessionId, prompt) {
      const resolved = await services.sessionController.resolveAgent(sessionId)
      if ("error" in resolved) throw resolved.error
      const agent = host.agents.get(sessionId)
      if (agent === undefined) throw new Error(`the session "${sessionId}" has no live Agent`)
      host.agents.withoutInitiator(() =>
        agent.followup(
          createUserMessage({
            content: [{ type: "text", text: prompt.text }],
            source: { kind: "bot-schedule", form: "notice", summary: prompt.summary },
          }),
        ),
      )
    },
    archive: (sessionId) =>
      services.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }),
    later: (ms, work) => later(work, Math.min(ms, MAX_TIMER_MS)),
    separateLimitMs: SEPARATE_RUN_LIMIT_MS,
    now: Date.now,
    newId: () => `run-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    warn,
  })
  const scheduler = createScheduler({
    store: scheduleStore,
    start(job, scheduledAt) {
      scheduleRunner.start(job, "schedule", scheduledAt).catch((error: unknown) => {
        warn(`bot-core: the run of schedule job "${job.id}" failed: ${String(error)}`)
      })
    },
    now: Date.now,
    later: (ms, work) => later(work, ms),
    maxDelayMs: MAX_TIMER_MS,
    warn,
  })
  ctx.effect(() => () => scheduler.dispose(), "bot-core: schedules")
  events.on("session/event", (session: { id: string }, event: SessionEventLike) =>
    scheduleRunner.sessionEvent(session.id, event),
  )
  const scheduleCaller = (botId: string, token: string, agentId: string): ScheduleCaller => {
    if (realizer.registration(botId)?.revisionToken !== token) {
      return {
        kind: "refused",
        reason: "this preset revision of the bot is no longer the registered one; start a new turn",
      }
    }
    const agent = host.agents.get(agentId)
    if (agent === undefined || sessionBotOf(agent) !== botId) {
      return { kind: "refused", reason: "schedule runs only in a session of this bot" }
    }
    if (table.get(botId)?.mainSessionId === agentId) return { kind: "main", sessionId: agentId }
    const run = scheduleRunner.runOfSession(agentId)
    if (run?.botId === botId) return { kind: "run", sessionId: agentId, jobId: run.jobId }
    return {
      kind: "refused",
      reason:
        "schedule works only in the bot's Main session and in a scheduled run's own session (not in other sessions or subagents)",
    }
  }
  const scheduleTools = createScheduleTools({
    caller: scheduleCaller,
    store: scheduleStore,
    runner: scheduleRunner,
    changed() {
      scheduler.sync()
      skillPanel.jobsChanged()
    },
    botTimezone: (botId) => registry.timezoneOf(botId),
    now: Date.now,
    newId: () => `job-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
    warn,
  })

  // Skill curation (docs/specs/bot-skills.md §12): the daily archive of unused
  // skills and the weekly tidy-up by the model in a hidden session.
  const createCuratorAgent = async (botId: string, sessionId: string): Promise<CuratorCreation> => {
    const mainSessionId = table.get(botId)?.mainSessionId
    if (mainSessionId === undefined)
      return { kind: "unavailable", reason: "the bot has no Main session" }
    return realizer.run(botId, async (state): Promise<CuratorCreation> => {
      if (!state.ready) return { kind: "unavailable", reason: state.problem }
      const cwd = environments.current()?.workspace
      if (cwd === undefined)
        return { kind: "unavailable", reason: "no bot environment is registered" }
      const model = await botModels.sessionModel(botId, { role: "main" })
      const handle = await host.agents.create({
        sessionId,
        agentOptions: model.kind === "fixed" ? { ...model.selection } : profileDefaultOptions(),
        meta: { cwd, agentPreset: state.id, parentSession: mainSessionId, origin: "subagent" },
        async setup(agentCtx, created) {
          installModelSelection(agentCtx)
          if (model.kind === "fixed") created.model.select(model.selection)
          ;(agentCtx as unknown as ScopedTools).tools.guard((execution) =>
            execution.name === SKILL_MANAGE_TOOL ? undefined : CURATION_REFUSAL,
          )
          await host.agentPresets.mount(agentCtx, state.id)
        },
      })
      return {
        kind: "created",
        agent: {
          prompt(text: string, summary: string) {
            host.agents.withoutInitiator(() =>
              handle.agent.followup(
                createUserMessage({
                  content: [{ type: "text", text }],
                  source: { kind: "bot-skills", form: "notice", summary },
                }),
              ),
            )
          },
          dispose: () => handle.dispose(),
        },
      }
    })
  }
  const curationRunner = createCurationRunner({
    sessions: curatorSessions,
    newId: () => `session-${randomUUID()}`,
    create: createCuratorAgent,
    later: (ms, work) => later(work, ms),
    limitMs: SKILL_CURATION_LIMIT_MS,
  })
  const skillCuration = createSkillCuration({
    bots: botIds,
    store: skillStore,
    async sweep(botId) {
      const place = registeredSkillsPlace(botId)
      if (place === undefined) return "unavailable"
      await botSkills.sweep(
        botId,
        place,
        (skills) =>
          skillRetentions.due(
            botId,
            skills.map((skill) => skill.name),
            Date.now(),
          ),
        UNUSED_ARCHIVE_REASON,
        AbortSignal.any([AbortSignal.timeout(SKILL_SWEEP_LIMIT_MS), unload.signal]),
      )
      return "swept"
    },
    async skills(botId) {
      const place = registeredSkillsPlace(botId)
      if (place === undefined) return undefined
      const catalog = await botSkills.catalog(
        botId,
        place,
        AbortSignal.any([AbortSignal.timeout(SKILL_SWEEP_LIMIT_MS), unload.signal]),
      )
      return catalog.skills
    },
    mainOf: (botId) => table.get(botId)?.mainSessionId,
    idle(sessionId) {
      const agent = host.agents.get(sessionId)
      return (
        agent === undefined ||
        (agent.status === "idle" &&
          agent.inbox.nextTurn.length === 0 &&
          agent.inbox.nextStep.length === 0)
      )
    },
    curate: (botId) => curationRunner.run(botId),
    now: Date.now,
    later: (ms, work) => later(work, ms),
    maxDelayMs: MAX_TIMER_MS,
    warn,
  })
  ctx.effect(() => {
    const offs = [
      environmentServices.subscribe((botId) => skillCuration.sync(botId)),
      realizer.subscribe((botId) => skillCuration.sync(botId)),
      botSkills.subscribe((botId) => skillCuration.sync(botId)),
      skillStore.subscribe((botId) => skillCuration.sync(botId)),
      registry.subscribe(() => skillCuration.sync()),
    ]
    return () => {
      for (const off of offs) off()
      skillCuration.dispose()
    }
  }, "bot-core: skill curation")
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    curationRunner.sessionEvent(session.id, event)
    skillCuration.activity(session.id)
  })
  events.on("agent/status", ({ agent }: { agent: { id: string } }) =>
    skillCuration.activity(agent.id),
  )

  // Managed sessions (docs/specs/bot-managed-sessions.md): sessions of a bot
  // its Main session started or its owner handed over, operated with the
  // session tools; what happens in them reaches the Main as notices.
  const managedDomain = await services.storageDomain.open(MANAGED_SESSIONS_DOMAIN)
  ctx.effect(() => () => void managedDomain.close(), "bot-core: managed sessions storage domain")
  const tellManaged = (session: BotManagedSession, event: SessionNoticeEvent) =>
    outbox.enqueue(session.botId, "session", sessionNotice(session, event)).then(() => undefined)
  const tellManagedLater = (session: BotManagedSession, event: SessionNoticeEvent) => {
    tellManaged(session, event).catch((error: unknown) => {
      warn(
        `bot-core: could not store a notice of managed session "${session.sessionId}": ${String(error)}`,
      )
    })
  }
  const dshWorkspaces = (): DshWorkspace[] =>
    services.workspaceRegistry.list().map((workspace) => ({
      workspaceId: workspace.id,
      title: workspace.title,
      path: workspace.path,
    }))
  const workspaceOfSession = (sessionId: string) =>
    services.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
      ?.id
  const readWorkspaceOptions = async () =>
    workspaceOptions({
      presets: await host.agentPresets.list(),
      defaultPreset: host.agentPresets.defaultId,
      permissions: permissionCatalog,
    })
  // Workspaces owners grant bots (docs/specs/bot-managed-sessions.md §10).
  const grants = createWorkspaceGrants({
    store: createGrantStore({ workspaceGrants: managedDomain.table("workspaces") }),
    exists: (botId) => table.get(botId) !== undefined,
    workspaces: dshWorkspaces,
    options: readWorkspaceOptions,
    async modelProblem(choice) {
      try {
        await botModels.resolve(choice)
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    ended: (grant, by) => managed.grantEnded(grant.botId, grant.workspaceId, by),
    now: Date.now,
  })
  const managed = createManagedSessions({
    store: createManagedStore({ managedSessions: managedDomain.table("sessions") }),
    botOfSession: (sessionId) => registry.botOfSession(sessionId),
    workspaceOfSession,
    granted: (botId, workspaceId) => grants.get(botId, workspaceId) !== undefined,
    mainOf: (botId) => table.get(botId)?.mainSessionId,
    pastMain: (sessionId) => registry.pastMain(sessionId),
    isScheduleRun: (sessionId) =>
      scheduleStore.runOfSession(sessionId) !== undefined ||
      scheduleRunner.runOfSession(sessionId) !== undefined,
    archived: (sessionId) => services.workspaceRegistry.archivedSessionIds.includes(sessionId),
    ended: (session, by) => tellManaged(session, { kind: "released", by }),
    now: Date.now,
  })
  const managedFollow = createManagedFollow({
    managed: (sessionId) => managed.get(sessionId),
    tell: tellManagedLater,
  })
  interactionOpened = (sessionId, interaction) => managedFollow.opened(sessionId, interaction)
  const workspaceManaged = (sessionId: string) => {
    const session = managed.get(sessionId)
    return session?.target.kind === "workspace" ? session : undefined
  }
  managedWorkspaceBot = (sessionId) => workspaceManaged(sessionId)?.botId
  mainAnsweredWorkspace = (sessionId) => {
    const session = workspaceManaged(sessionId)
    return session?.answerer === "main" ? session.botId : undefined
  }
  const managedWaits = createManagedWaits<LiveAgent>({
    managedOf(agent) {
      let root = agent
      for (let depth = 0; root.session.header.origin === "subagent"; depth += 1) {
        const parent = parentOf(root)
        if (parent === undefined || depth >= MAX_DELEGATION_DEPTH) return undefined
        root = parent
      }
      return workspaceManaged(root.id)
    },
    opened: (session, wait) =>
      tellManagedLater(session, { kind: "waiting", interaction: wait.kind, answerer: "owner" }),
    newId: () => randomUUID().replaceAll("-", "").slice(0, 10),
  })
  dshWaits = managedWaits
  const authority = createTurnAuthority({
    isMain: (sessionId) => registry.botOfMain(sessionId) !== undefined,
  })
  events.on("session/event", (session: { id: string }, event: SessionEventLike) => {
    authority.sessionEvent(session.id, event)
    managedFollow.sessionEvent(session.id, event)
  })
  const workspaceChanges = new Set<() => void>()
  events.on("domain/changed", (change: { readonly domain: string }) => {
    if (change.domain !== "workspace") return
    for (const listener of [...workspaceChanges]) listener()
    grants.reconcile().catch((error: unknown) => {
      warn(`bot-core: could not drop the grants of removed Workspaces: ${String(error)}`)
    })
  })
  const workspaceSessions = createWorkspaceSessions<LiveAgent["session"]>({
    async model(choice) {
      if (choice.kind === "profile-default") return { kind: "profile-default" }
      return { kind: "fixed", selection: await botModels.resolve(choice) }
    },
    async create(request) {
      const created = await services.sessionController.create(request)
      return { sessionId: created.sessionId, agentPreset: created.agentPreset }
    },
    session(sessionId) {
      const agent = host.agents.get(sessionId)
      if (agent === undefined) throw new Error(`the session "${sessionId}" has no live Agent`)
      return agent.session
    },
    permit: (session, grant) => permissions.apply(session, grant.permission),
    select(sessionId, model) {
      host.agents.get(sessionId)?.model.select(model.selection)
    },
    async rename(sessionId, title) {
      await services.sessionController.rename({ sessionId, title })
    },
    discard: (sessionId) =>
      services.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }),
    warn,
  })
  const botNameOf = (botId: string) => {
    const record = table.get(botId)
    if (record === undefined) throw new Error(`bot "${botId}" does not exist`)
    return record.name
  }
  events.on("workspace/session-archived", (request: { sessionId: string }) => {
    managed.archived(request.sessionId).catch((error: unknown) => {
      warn(`bot-core: could not end the management of "${request.sessionId}": ${String(error)}`)
    })
  })
  /** The live Agent of a bot session, resumed if needed. */
  const liveAgent = async (sessionId: string): Promise<LiveAgent> => {
    const resolved = await services.sessionController.resolveAgent(sessionId)
    if ("error" in resolved) throw resolved.error
    const agent = host.agents.get(sessionId)
    if (agent === undefined) throw new Error(`the session "${sessionId}" has no live Agent`)
    return agent
  }
  const sendMainMessage = async (
    sessionId: string,
    message: MainMessage,
    mode: "queue" | "steer",
  ) => {
    const agent = await liveAgent(sessionId)
    const user = createUserMessage({ content: [...message.content], source: message.source })
    host.agents.withoutInitiator(() => {
      if (mode === "steer" && agent.status === "running") agent.inject(user)
      else agent.followup(user)
    })
  }
  const managedTools = createManagedTools({
    refusal: mainSessionRefusal("this tool"),
    sessions: managed,
    models(botId) {
      const { main, delegates } = modelStore.get(botId).models
      return { main, delegates }
    },
    create: async (botId, title, model) =>
      (await sessions.create(botId, { title, model }, { startedBy: "main" })).sessionId,
    createInWorkspace: (grant, options) => workspaceSessions.create(grant, options),
    workspaces: (botId) => grants.granted(botId),
    authority: (mainSessionId) => authority.refusal(mainSessionId),
    botName: botNameOf,
    send: sendMainMessage,
    messages: async (sessionId) => (await liveAgent(sessionId)).session.deriveMessages(),
    activity: (sessionId) => host.agents.get(sessionId)?.status ?? "idle",
    interactions: (sessionId) => interactions.openIn(sessionId),
    waits: (sessionId) => managedWaits.openIn(sessionId),
    answer: (sessionId, interactionId, answer) =>
      interactions.answer({ kind: "session", sessionId }, interactionId, answer, { via: "main" }),
    stop(sessionId) {
      services.sessionController.cancel({ sessionId })
    },
    archive: (sessionId) =>
      services.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }),
    follow: managedFollow,
  })
  new BotManagedSessionsRemoteService(
    ctx,
    createManagedPanel({
      sessions: managed,
      listed: (botId) => registry.get(botId) !== undefined,
    }),
    (listener) => managed.subscribe(listener),
  )
  new BotWorkspacesRemoteService(
    ctx,
    createWorkspacesPanel({
      grants,
      options: readWorkspaceOptions,
      listed: (botId) => registry.get(botId) !== undefined,
    }),
    (listener) => {
      workspaceChanges.add(listener)
      const off = grants.subscribe(listener)
      return () => {
        workspaceChanges.delete(listener)
        off()
      }
    },
  )

  events.on("session/event", (_session: { id: string }, event: { type: string; data: unknown }) => {
    if (event.type !== "user/message") return
    const { id } = event.data as { readonly id?: unknown }
    if (typeof id === "string") delivery.recorded(id)
  })
  events.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => {
    if (status === "idle") delivery.idle(agent.id)
  })
  const forgetDeleted = () => {
    const exists = (botId: string) => table.get(botId) !== undefined
    Promise.all([
      broker.prune(exists),
      connectorPermissions.purge(exists),
      connectorSettings.purge(exists),
      specStore.purge(exists),
      connectionStore.purgeBots(exists),
      vaultStore.purgeBots(exists),
      outbox.purge(exists),
      scheduleStore.purge(exists),
      mainStore.purge(exists),
      modelStore.purge(exists),
      skillStore.purge(exists),
      managed.purge(exists),
      grants.purge(exists),
    ]).catch((error: unknown) => {
      warn(
        `bot-core: could not forget the connector and schedule data of deleted bots: ${String(error)}`,
      )
    })
  }
  ctx.effect(() => registry.subscribe(forgetDeleted), "bot-core: connector data of bots")
  await broker.recover()
  await scheduleRunner.recover()
  forgetDeleted()
  await grants.reconcile()
  readiness.sync()
  delivery.start()
  void registered.then(() => mains.pokeAll())
  scheduler.sync()
  skillCuration.sync()
  void pruneEvents()
  pruneEventsLater()
  eventDelivery.start()
  eventPoller.sync()
  const connectorCaller = (botId: string, token: string, agentId: string): ConnectorCaller => {
    if (realizer.registration(botId)?.revisionToken !== token) {
      return {
        kind: "refused",
        reason: "this preset revision of the bot is no longer the registered one; start a new turn",
      }
    }
    const agent = host.agents.get(agentId)
    if (agent === undefined || sessionBotOf(agent) !== botId) {
      return { kind: "refused", reason: "a connector tool runs only in a session of this bot" }
    }
    return {
      kind: table.get(botId)?.mainSessionId === agentId ? "main" : "bot",
      sessionId: agentId,
    }
  }
  const connectorPanel = createConnectorPanel({
    catalog: connectorCatalog,
    settings: connectorSettings,
    readiness,
    permissions: connectorPermissions,
    accounts: connectorAccounts,
    waiting: (botId, connectorId) => eventStore.unread(botId, connectorId).length,
    subscribeAccounts(listener) {
      const offs = [connectionStore.subscribe(listener), eventStore.subscribe(() => listener())]
      return () => {
        for (const off of offs) off()
      }
    },
    statuses,
    exists: (botId) => table.get(botId) !== undefined,
    spec: (botId) => specStore.get(botId),
    subscribeSpecs: (listener) => specStore.subscribe(listener),
  })
  const connectors = createConnectorsBackend({
    catalog: connectorCatalog,
    permissions: connectorPermissions,
    settings: connectorSettings,
    readiness,
    statuses,
    ledger,
    broker,
    surface: createConnectorToolSurface({
      catalog: connectorCatalog,
      permissions: connectorPermissions,
      settings: connectorSettings,
      ledger,
      usableAccounts: (botId, connector) =>
        connectorAccounts.usable(botId, connector).map((record) => record.id),
      subscribeAccounts: (listener) => connectionStore.subscribe(listener),
    }),
    panel: connectorPanel,
    own: createConnectorOwnTools({
      catalog: connectorCatalog,
      accounts: connectorAccounts,
      store: eventStore,
      account: accountName,
      newNonce: () => randomBytes(8).toString("hex"),
    }),
    exists: (botId) => table.get(botId) !== undefined,
    caller: connectorCaller,
  })
  new BotConnectorsRemoteService(ctx, connectorPanel)
  const environmentPanel = createEnvironmentPanel({
    store: specStore,
    environment: environments,
    needs: connectorNeeds,
    listed: (botId) => registry.get(botId) !== undefined,
  })
  new BotEnvironmentHostRemoteService(
    ctx,
    createEnvironmentHostPanel({
      environment: environments,
      botName: (botId) => registry.get(botId)?.name,
      onBots: (listener) => registry.subscribe(() => listener()),
    }),
  )
  new BotEnvironmentRemoteService(ctx, environmentPanel, (listener) => {
    const offs = [
      specStore.subscribe(() => listener()),
      environments.subscribe(() => listener()),
      environments.onActivity(() => listener()),
      connectorSettings.subscribe(() => listener()),
      connectorCatalog.subscribe(() => listener()),
      environmentPanel.subscribe(listener),
    ]
    return () => {
      for (const off of offs) off()
    }
  })
  // Decisions on connector actions come only from the owner: the Web UI's
  // Remote and the channels' approvers (README, "Connector approvals").
  const connectorApprovals = createConnectorApprovals({
    ledger,
    broker,
    catalog: connectorCatalog,
    exists: (botId) => table.get(botId) !== undefined,
  })
  new BotConnectorActionsRemoteService(ctx, connectorApprovals)
  new BotConnectorStreamsRemoteService(ctx, connectorStreams)
  ctx.effect(
    () =>
      connectorApprovals.subscribe((action) =>
        outlets.publish(action.botId, { kind: "connector-action", action }),
      ),
    "bot-core: connector actions in channels",
  )

  const describePrompt = createPromptFacts<LiveAgent>({
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    agent: (agentId) => host.agents.get(agentId),
    botOf: sessionBotOf,
    kind: sessionKinds,
    management(botId, sessionId) {
      const session = managed.get(sessionId)
      return session?.botId === botId ? { answerer: session.answerer } : undefined
    },
    botName: (botId) => table.get(botId)?.name,
    channels: () =>
      channelCatalog.list().map((channel) => ({
        name: channel.name,
        ...(channel.formatHint === undefined ? {} : { formatHint: channel.formatHint }),
      })),
    channelStatus: (botId) => channelStatus(botId),
    connectors: (botId) => connectors.states(botId),
    web: () => webState.status(),
    logins: (botId) => vaultStore.grants(botId).length > 0,
  })

  // Past conversations: conversation_search and conversation_read (docs/specs/bot-session-search.md).
  let sessionLogs: SessionLogReader | undefined
  ctx.inject(["sessionQuery"], (queryCtx) => {
    const query = (queryCtx as unknown as SessionQueryServices).sessionQuery
    const reader: SessionLogReader = async (sessionId, signal) => {
      let observation: SessionLog & Disposable
      try {
        observation = await query.observeSession(sessionId, { signal, projectionMode: "none" })
      } catch (error) {
        if ((error as { readonly code?: unknown }).code === SESSION_NOT_FOUND) return undefined
        throw error
      }
      try {
        return {
          inheritedEventCount: observation.inheritedEventCount,
          events: [...observation.events],
        }
      } finally {
        observation[Symbol.dispose]()
      }
    }
    queryCtx.effect(() => {
      sessionLogs = reader
      return () => {
        sessionLogs = undefined
      }
    }, "bot-core: session history of past conversations")
  })
  // The Main as its channels see it, across its Mains (docs/specs/bot-main-view.md).
  const mainView = createMainView({
    mainsOf: (botId) => registry.mainsOf(botId),
    async read(sessionId, signal) {
      if (sessionLogs === undefined) throw new Error("DSH's session history is not available")
      return sessionLogs(sessionId, signal)
    },
    async readImage(ref, signal) {
      if (imageReads === undefined) throw new Error("DSH's attachment store is not available")
      return (await imageReads.readImage(ref, signal)).data
    },
    encodeBase64: (data) =>
      Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"),
    subscribe: (listener) => registry.subscribe(listener),
    signal: unload.signal,
  })
  events.on("session/event", (session: { id: string }, event: SessionLogEvent) =>
    mainView.sessionEvent(session.id, event),
  )
  new BotMainViewRemoteService(ctx, mainView)

  const botConversations = createBotConversations<LiveAgent>({
    sealed: (botId, token) => revisionTokens.get(botId)?.has(token) === true,
    agent: (agentId) => host.agents.get(agentId),
    botOf: sessionBotOf,
    kind: sessionKinds,
    reviews: reviewSessions,
    tools: createConversationTools({
      sources: (botId, callerId) =>
        ownerConversations(
          {
            kind: sessionKinds,
            sessionsOf: (id) => registry.sessionsOf(id),
            pastMain: (sessionId) => registry.pastMain(sessionId),
          },
          botId,
          callerId,
        ),
      reader: () => sessionLogs,
      timezone: (botId) => registry.timezoneOf(botId),
    }),
  })

  new BotService(ctx, {
    describePrompt,
    conversations: {
      available: (botId, token, agentId) => botConversations.available(botId, token, agentId),
      call: (botId, token, request, signal) => botConversations.call(botId, token, request, signal),
    },
    notes: {
      call: (botId, token, request, signal) => botNotes.call(botId, token, request, signal),
      prepare: (botId, token, request, signal) => botNotes.prepare(botId, token, request, signal),
      pinned: (botId, token, agentId) => botNotes.pinned(botId, token, agentId),
    },
    connectors: {
      ...connectors,
      toolAvailable: (botId, token, agentId, name) =>
        connectors.toolAvailable(botId, token, shownAs(agentId), name),
    },
    connectionProviders: connectionProviders,
    vaults: {
      register: (provider) => vaultProviders.register(provider),
      list: () => vaultProviders.list(),
      ...vaultRows,
    },
    stayChannelSilent: (botId, token, request) => silencer.staySilent(botId, token, request),
    schedules: {
      available: (botId, token, agentId, tool) =>
        scheduleTools.available(botId, token, shownAs(agentId), tool),
      call: (botId, token, request) => scheduleTools.call(botId, token, request),
    },
    skills: {
      available: (botId, token, agentId) => botSkills.available(botId, token, agentId),
      call: (botId, token, request, signal) => botSkills.call(botId, token, request, signal),
      prepare: (botId, token, agentId, signal) => botSkills.prepare(botId, token, agentId, signal),
      list: (botId, token, signal) => botSkills.list(botId, token, signal),
      load: (botId, token, name, signal) => botSkills.load(botId, token, name, signal),
      watch: (botId, token, listener) => botSkills.watch(botId, token, listener),
    },
    managedSessions: {
      available: (botId, token, agentId) => managedTools.available(botId, token, shownAs(agentId)),
      call: (botId, token, request) => managedTools.call(botId, token, request),
    },
    environmentServices,
    compactors,
    mainPreparations,
    registry,
    botIds,
    channels: channelCatalog,
    templates: catalog,
    presetOf: presetState,
    onPresetChange: (listener) => realizer.subscribe(listener),
    previewPreset(botId, change) {
      const record = requireRecord(botId)
      const parsed = inbound(change)
      return realizer.preview(botId, {
        name: record.name,
        template: parsed.template ?? record.template,
        overlay: parsed.overlay ?? record.overlay,
      })
    },
    async configurePreset(botId, change) {
      requireRecord(botId)
      const parsed = inbound(change)
      await registry.setPreset(botId, parsed, (merged) => {
        const result = realizer.check(botId, merged)
        if (!result.ok) throw new Error(result.problem)
      })
      const state = await realizer.refresh(botId, { retry: true })
      if (state === undefined) throw new Error(`bot "${botId}" does not exist`)
      return presetState(botId) ?? state
    },
    createSession: (botId, options) => sessions.create(botId, options),
    models: {
      view: (botId) => botModels.view(botId),
      configure: (botId, change) => botModels.configure(botId, change),
      catalog: () => modelCatalog.read(),
      resolve: (choice) => botModels.resolve(choice),
      subscribe: (listener) => modelStore.subscribe(listener),
    },
    environments,
    web: {
      register: (backend) => webBackends.register(backend),
      list: () => webBackends.list(),
      status: () => webState.status(),
      subscribe: (listener) => webState.subscribe(listener),
      ready: (botId, token, capability) => webBridge.ready(botId, token, capability),
      search: (botId, token, request, signal) => webBridge.search(botId, token, request, signal),
      fetch: (botId, token, request, signal) => webBridge.fetch(botId, token, request, signal),
    },
  })
  new BotsRemoteService(ctx, {
    lifecycle,
    update: (id, input) => registry.update(id, input),
    creationOptions: async () => ({
      options: creationConnectors.offer(),
      // A new bot's capacity: read for an id no bot has, as the bot created next gets one.
      capacity: await initialSpecs.capacity(newBotId()),
    }),
    models: createModelPanel({
      models: botModels,
      catalog: modelCatalog,
      subscribe: (listener) => modelStore.subscribe(listener),
    }),
    createSession: (botId) => sessions.create(botId),
  })
  new BotOnboardingRemoteService(
    ctx,
    createOnboardingPanel({
      store: onboardingStore,
      version: releases.version,
      notes: releaseNotes,
      channels: welcomeChannels,
      create: (input) => lifecycle.create(input),
      discard: (botId) => lifecycle.discardCreate(botId),
      now: Date.now,
    }),
  )
  ctx.effect(
    () =>
      followWelcomeBot({
        store: onboardingStore,
        bots: {
          snapshot: () => lifecycle.snapshot(),
          subscribe: (listener) => lifecycle.subscribe(listener),
        },
        now: Date.now,
        warn,
      }),
    "bot-core: the welcome guide's bot",
  )

  /** The bot's channels its settings turn on (none while DSH has no credential store, which channels need). */
  let channelStatus: (botId: string) => readonly BotStatusChannel[] = () => []

  // Channels (Discord, ...): bots' channel settings, their secrets in DSH's
  // credential store, and one connection per bot and channel to its Main session.
  ctx.inject(["credentials"], async (channelsCtx) => {
    const credentials = (channelsCtx as unknown as CredentialServices).credentials
    const channelsDomain = await services.storageDomain.open(CHANNELS_DOMAIN)
    channelsCtx.effect(() => () => void channelsDomain.close(), "bot-core: channels storage domain")
    const settings = createChannelSettings({
      records: channelsDomain.table("channels"),
      vault: createSecretVault(credentials),
      now: Date.now,
      warn,
    })

    let forms: () => readonly SettingsForm[] = () => []
    channelsCtx.inject(["settings"], (settingsCtx) => {
      const service = (settingsCtx as unknown as SettingsServices).settings
      settingsCtx.effect(() => {
        forms = () => service.describe()
        return () => {
          forms = () => []
        }
      }, "bot-core: composer preference")
    })

    let imageLimits: () => ImageLimits | undefined = () => undefined
    channelsCtx.inject(["attachments"], (attachmentsCtx) => {
      const service = (attachmentsCtx as unknown as AttachmentServices).attachments
      attachmentsCtx.effect(() => {
        imageLimits = () => service.imageLimits
        return () => {
          imageLimits = () => undefined
        }
      }, "bot-core: image limits")
    })

    const mainSessionOf = (botId: string) => table.get(botId)?.mainSessionId
    const commands = createCommandRunner({
      mainSessionOf,
      agentOf(sessionId) {
        const agent = host.agents.get(sessionId)
        if (agent === undefined) return undefined
        const model = agent.model.current()
        const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(
          (message) => message.source.kind === "user",
        ).length
        return { activity: agent.status, ...(model === undefined ? {} : { model }), queued }
      },
      async cancel(sessionId) {
        services.sessionController.cancel({ sessionId })
      },
      startNew: (botId) => mains.startNew(botId),
    })
    const conversation: ConversationDeps = {
      mainSessionOf,
      shield: async (botId, sessionId, message) => ({
        ...message,
        text: await vaultGuard.shield({ botId, sessionId }, "inbound-message", message.text),
      }),
      activityOf: (sessionId) => host.agents.get(sessionId)?.status ?? "idle",
      busyMode: () => busyModeOf(forms()),
      compose: (request, signal) =>
        composePrompt(
          {
            imageLimits: () => imageLimits(),
            limits: config.channels.attachments,
            inboxOf(botId) {
              const subprocess = environmentOf(botId)?.subprocess
              const workspace = environments.current()?.workspace
              if (subprocess === undefined || workspace === undefined) return undefined
              return {
                root: `${workspace}/${INBOX_DIRECTORY}`,
                writer: createShellInboxWriter(subprocess as EnvironmentWriteSubprocess, workspace),
              }
            },
            encodeBase64: (data) =>
              Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"),
          },
          {
            botId: request.botId,
            channelId: request.channelId,
            capability: request.capabilities.attachments,
            message: request.message,
            header: request.header,
          },
          signal,
        ),
      async prompt({ botId, sessionId, content, mode }, signal) {
        await services.sessionController.prompt(
          {
            requestId: randomUUID(),
            sessionId,
            mode,
            content,
            clientTimeZone: registry.timezoneOf(botId),
          },
          signal,
        )
      },
      run: (botId, command) => commands.run(botId, command),
      interactions,
      admit: (botId, work) => mains.admit(botId, work),
    }
    const presentedReads = new AbortController()
    channelsCtx.effect(() => () => presentedReads.abort(), "bot-core: reads of presented files")
    const presentedDelivery = createPresentedDelivery({
      environmentOf(botId) {
        const environment = environmentOf(botId)
        const workspace = environments.current()?.workspace
        return environment === undefined || workspace === undefined
          ? undefined
          : { fs: environment.fs as EnvironmentFileSystem, workspace }
      },
      outlets,
      maxBytes: config.channels.files.maxBytes,
      signal: () =>
        AbortSignal.any([presentedReads.signal, AbortSignal.timeout(PRESENTED_READ_MS)]),
      async notify(botId, notice) {
        await outbox.enqueue(botId, "file", notice)
      },
      warn,
    })
    const feed = createMainFeed({
      botOfMainSession(sessionId) {
        for (const [botId, record] of table.entries()) {
          if (record.mainSessionId === sessionId) return botId
        }
        return undefined
      },
      isSilent: (sessionId) => turnSilence.isSilent(sessionId),
      isMaintenance: (sessionId, event) => maintenanceTurns.belongs(sessionId, event),
      presented: createPresentedFiles(),
      sequence: createChannelSequence({
        publish: (botId, output) => outlets.publish(botId, output),
        warn,
      }),
      deliverFiles: (botId, files) => presentedDelivery.deliver(botId, files),
    })
    const channelEvents = channelsCtx as unknown as HostEvents
    channelEvents.on("session/event", (session: { id: string }, event: SessionEventLike) =>
      feed.sessionEvent(session.id, event),
    )

    const hub = createChannelHub({
      channels: () => channelCatalog.list(),
      bots: () => registry.list(),
      settings,
      conversation,
      outlets,
      interactions,
      approvals: connectorApprovals,
      incidents: {
        open: (botId) =>
          vaultStore
            .incidents(botId)
            .filter((incident) => incident.acknowledgedAt === undefined)
            .reverse()
            .map(incidentView),
      },
      warn,
    })
    channelsCtx.effect(() => () => hub.dispose(), "bot-core: channel connections")
    const purge = () =>
      settings
        .purge((botId) => table.get(botId) !== undefined)
        .catch((error: unknown) => {
          warn(`bot-core: could not forget the channel settings of deleted bots: ${String(error)}`)
        })
    const upgradeThenSync = () =>
      void Promise.all(
        channelCatalog.list().map((channel) =>
          settings.upgrade(channel).catch((error: unknown) => {
            warn(
              `bot-core: could not upgrade the settings of channel "${channel.id}": ${String(error)}`,
            )
          }),
        ),
      ).then(() => hub.sync())
    channelsCtx.effect(() => channelCatalog.subscribe(upgradeThenSync), "bot-core: channels")
    channelsCtx.effect(
      () =>
        registry.subscribe(() => {
          hub.sync()
          void purge()
        }),
      "bot-core: channels of bots",
    )
    channelsCtx.effect(() => settings.subscribe(() => hub.sync()), "bot-core: channel settings")
    void purge()
    upgradeThenSync()

    const panel = createChannelPanel({
      channels: () => channelCatalog.list(),
      channel: (id) => channelCatalog.get(id),
      bot(botId) {
        const record = table.get(botId)
        return record === undefined ? undefined : { id: botId, name: record.name }
      },
      listed: (botId) => registry.get(botId) !== undefined,
      settings,
      hub,
      deadline: () => AbortSignal.timeout(CHANNEL_QUERY_MS),
    })
    channelsCtx.effect(() => {
      channelStatus = (botId) =>
        panel
          .snapshot(botId)
          .channels.filter((view) => view.enabled)
          .map((view) => ({
            name: view.channel.name,
            status: view.status,
            owners: [...ownersOf(view.channel, view.values)],
          }))
      return () => {
        channelStatus = () => []
      }
    }, "bot-core: channels in the bots' status")
    channelsCtx.effect(
      () =>
        welcomeChannels.attach(async (botId, channelId, change) => {
          const result = await panel.configure(botId, channelId, change)
          if (!result.saved) throw new Error(result.reason.en)
        }),
      "bot-core: the welcome guide's channels",
    )
    new BotChannelsRemoteService(channelsCtx, panel, (listener) => {
      const offs = [
        hub.subscribe(listener),
        settings.subscribe(listener),
        channelCatalog.subscribe(listener),
        registry.subscribe(listener),
      ]
      return () => {
        for (const off of offs) off()
      }
    })
  })

  const guard = createMainGuard({
    registry,
    unarchive: (sessionId) => services.workspaceRegistry.unarchiveSession(sessionId),
    warn: (message) => ctx.logger.warn(message),
    later: (work) => {
      later(work, 0)
    },
  })
  events.on(
    "workspace/session-activity",
    (request: { sessionId: string }, next: () => Promise<unknown>) => guard.activity(request, next),
  )
  events.on("workspace/session-archived", (request: { sessionId: string }) =>
    guard.archived(request),
  )

  // Effects end in reverse order, so this runs first on unload: in-flight
  // environment preparations are aborted (environments are kept), the bot
  // presets go before isolation stops, and no bot Agent can be created
  // unclassified meanwhile. (Guards and masks of live Agents stay.)
  ctx.effect(
    () => async () => {
      halt()
      approvals.delegateAll()
      interactions.withdrawAll()
      lifecycle.dispose()
      environments.dispose()
      await realizer.dispose()
      isolation.dispose()
    },
    "bot-core: unload order",
  )
}
