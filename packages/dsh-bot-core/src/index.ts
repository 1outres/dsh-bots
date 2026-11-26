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
import { createHeldReplies } from "./host/channels/held-replies"
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
    "bot-connector": { kind: "bot-connector"; form: "notice"; summary: string }
    "bot-schedule": { kind: "bot-schedule"; form: "notice"; summary: string }
    "bot-skills": { kind: "bot-skills"; form: "notice"; summary: string }
    "bot-notes": { kind: "bot-notes"; form: "notice"; summary: string }
    "bot-connector-event": { kind: "bot-connector-event"; form: "notice"; summary: string }
    "bot-main": { kind: "bot-main"; form: "notice"; summary: string }
    "bot-file": { kind: "bot-file"; form: "notice"; summary: string }
    "bot-session": { kind: "bot-session"; form: "notice"; summary: string }
    "bot-main-relay": { kind: "bot-main-relay"; form: "relay" }
    "working-directory": { kind: "working-directory" }
  }
}

export const DEFAULT_GREETING =
  "You are {name}. This is the very first moment of your Main session, the conversation your owner keeps with you. Greet your owner warmly and briefly in {language}, introduce yourself as {name}, and ask what they would like to do together."

export const DEFAULT_ENVIRONMENT = "incus-vm"

const WORKSPACE_FILES_TIMEOUT_MS = 60_000
const MAX_TIMER_MS = 2147483647
const MAX_DELEGATION_DEPTH = 32
const MAX_SSH_PAYLOAD_BYTES = 32 * 1024 * 1024
const MAX_CHANNEL_FILE_BYTES = 512 * 1024 * 1024
const PRESENTED_READ_MS = 60_000
const CHANNEL_QUERY_MS = 15_000
const RELEASES_READ_LIMIT_MS = 20_000
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

const EVENT_BATCH_MS = 60_000
const EVENTS_PER_STREAM = 500
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000
const UNREAD_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000
const EVENT_PRUNE_EVERY_MS = 60 * 60_000

const CONNECTOR_RETENTION_MS = 7 * 24 * 60 * 60_000
const NOTICE_READY_WAIT_MS = 15_000
const NOTICE_RETRY = { initialMs: 5_000, maxMs: 10 * 60_000 } as const
const SCHEDULE_RUNS_KEPT = 20
const SEPARATE_RUN_LIMIT_MS = 60 * 60_000
export const MAIN_MAINTENANCE_LIMIT_MS = 5 * 60_000
const MAIN_MAINTENANCE_RETRY = { initialMs: 5 * 60_000, maxMs: 2 * 60 * 60_000 } as const

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

const GUARD_SCRYPT = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const GUARD_DIGEST_BYTES = 32

const guardDigest = (bytes: Uint8Array, salt: Uint8Array): Promise<string> =>
  new Promise((resolve, reject) => {
    scrypt(bytes, salt, GUARD_DIGEST_BYTES, GUARD_SCRYPT, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key.toString("base64"))
    })
  })

const GUARD_SCAN_LIMIT = 2 * 1024 * 1024

const guardKeyCache = new WeakMap<GuardKeyMaterial, GuardKeys>()

function derivedGuardKeys(material: GuardKeyMaterial): GuardKeys {
  const known = guardKeyCache.get(material)
  if (known !== undefined) return known
  const keys = guardKeysOf(material)
  guardKeyCache.set(material, keys)
  return keys
}

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

interface SessionQueryServices {
  sessionQuery: {
    observeSession(
      sessionId: string,
      options: { readonly signal: AbortSignal; readonly projectionMode: "none" },
    ): Promise<SessionLog & Disposable>
  }
}

const SESSION_NOT_FOUND = "SESSION_QUERY_SESSION_NOT_FOUND"

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
    get(id: string): { sessionIds: readonly string[] } | undefined
    delete(id: string): Promise<boolean>
    list(): readonly {
      readonly id: string
      readonly title: string
      readonly path: string
      readonly sessionIds: readonly string[]
    }[]
  }
  sessionController: {
    create(request: {
      workspaceId: string
      agentPreset: string
    }): Promise<{ sessionId: string; agentPreset?: string }>
    rename(request: { sessionId: string; title: string }): Promise<unknown>
    resolveAgent(sessionId: string): Promise<{ agent: AgentLike } | { error: unknown }>
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
    cancel(request: { sessionId: string }): { accepted: true }
  }
  agentDefaultModel: {
    currentSelection(): BotModelSelection
  }
  llm: LlmRegistry
  workingDirectory: {
    get(session: LiveAgent["session"]): string
  }
  approval: { overrideOf(session: LiveAgent["session"]): ApprovalPolicy | undefined }
  sandboxPolicy: { overrideOf(session: LiveAgent["session"]): SandboxMode | undefined }
}

interface PermissionPresetServices {
  permissionPresets: PermissionPresets<LiveAgent["session"]>
}

interface AgentLike {
  followup(message: ReturnType<typeof createUserMessage>): void
}

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
    snapshotEvents(): readonly ReviewSeedEvent[]
    requestHeader():
      | { readonly config: { provider: string; model: string; reasoningEffort?: string } }
      | undefined
  }
  inject(message: UserMessage): void
  followup(message: UserMessage): void
}

function asUserMessage(message: NoticeMessage): UserMessage {
  return message as unknown as UserMessage
}

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
  definitions(scope?: object): readonly ToolEntry[]
}

interface PresetServices {
  agentPresets: {
    register(preset: ComposedPreset): Promise<() => Promise<void>>
    resolve(id: string): Promise<{ id: string; broken?: string }>
    composedPreset(ctx: Context): string | undefined
    select(agent: LiveAgent, agentPreset: string): Promise<string>
    list(): Promise<readonly { id: string; name?: string; broken?: string }[]>
    readonly defaultId: string
    mount(ctx: Context, id: string): Promise<{ id: string }>
    serviceFor(agent: { ctx: Context }, name: "fs"): EnvironmentFs | undefined
  }
  tools: ToolsService
  agents: {
    list(): LiveAgent[]
    get(id: string): LiveAgent | undefined
    currentInitiator(): LiveAgent | undefined
    withoutInitiator<T>(operation: () => T): T
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

interface CredentialServices {
  credentials: CredentialRecords
}

interface AttachmentServices {
  attachments: { readonly imageLimits: ImageLimits }
}

interface SettingsServices {
  settings: { describe(): readonly SettingsForm[] }
}

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

interface ScopedTools {
  tools: {
    restrict(filter: { deny: readonly string[] }): () => void
    guard(guard: (execution: { readonly name: string }) => string | undefined): () => void
  }
}

interface HostEvents {
  on(
    name: string,
    // biome-ignore lint/suspicious/noExplicitAny: -
    listener: (...args: any[]) => unknown,
    options?: { prepend?: boolean },
  ): () => void
}

const RESUME_WAIT_MS = 15_000

const MAIN_MODEL_WAIT_MS = 10_000

const SKILL_REVIEW_LIMIT_MS = 5 * 60_000
const SKILL_CURATION_LIMIT_MS = 10 * 60_000
const SKILL_SWEEP_LIMIT_MS = 2 * 60_000
const SKILL_READ_LIMIT_MS = 60_000
const NOTES_READ_LIMIT_MS = 60_000

const ENVIRONMENT_WAIT_MS = 3 * 60_000
const ENVIRONMENT_INTERVAL_MS = 3_000
const ENVIRONMENT_PROBE_MS = 75_000

export async function apply(ctx: Context, config: BotCoreConfig): Promise<void> {
  const services = ctx as unknown as HostServices
  const host = ctx as unknown as PresetServices
  const events = ctx as unknown as HostEvents
  const warn = (message: string) => ctx.logger.warn(message)
  const startedAt = Date.now()

  const timers = new Set<ReturnType<typeof setTimeout>>()
  let unloading = false
  const unload = new AbortController()
  let stop: () => void = () => {}
  const stopped = new Promise<void>((resolveStop) => {
    stop = resolveStop
  })
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
  const sleep = (ms: number) =>
    Promise.race([new Promise<void>((done) => void later(done, ms)), stopped])

  const newBotId = () => randomUUID().slice(0, 8)

  const catalog = createTemplateCatalog({ warn })
  ctx.effect(() => catalog.register(defaultTemplate()), "bot-core: default template")

  const domain = await services.storageDomain.open(BOTS_DOMAIN)
  ctx.effect(() => () => void domain.close(), "bot-core: storage domain")
  const table = domain.table("bots")

  const botIds = () => [...table.entries()].map(([id]) => id)

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
  await modelStore.migrate(botIds())

  const webDomain = await services.storageDomain.open(WEB_DOMAIN)
  ctx.effect(() => () => void webDomain.close(), "bot-core: web storage domain")
  const webSettingsStoredBefore = webDomain.table("settings").get(WEB_SETTINGS_KEY) !== undefined
  const webStore = await openWebSettingsStore({ webSettings: webDomain.table("settings") })
  const webBackends = createWebBackendCatalog()
  const webState = createWebState({ store: webStore, catalog: webBackends, warn })
  ctx.effect(() => () => webState.dispose(), "bot-core: web lookup state")
  const webComposition = (): WebComposition => webState.servable()

  const connectorsDomain = await services.storageDomain.open(CONNECTORS_DOMAIN)
  ctx.effect(() => () => void connectorsDomain.close(), "bot-core: connectors storage domain")
  const connectorCatalog = createConnectorCatalog()
  const connectorPermissions = createConnectorPermissions({
    records: connectorsDomain.table("permissions"),
    catalog: connectorCatalog,
    now: Date.now,
  })
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
  const connectionsDomain = await services.storageDomain.open(CONNECTIONS_DOMAIN)
  ctx.effect(() => () => void connectionsDomain.close(), "bot-core: connections storage domain")
  const connectionStore = createConnectionStore({
    connections: connectionsDomain.table("connections"),
    grants: connectionsDomain.table("grants"),
    clients: connectionsDomain.table("clients"),
    now: Date.now,
  })
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
    held: (botId) => table.get(botId)?.creationFailure !== undefined,
    release: (botId) => realizer.refresh(botId),
    later,
    now: Date.now,
    warn,
    acceptedId: config.environment,
  })
  const initialSpecs = createInitialSpecs({ environment: environments })

  const filesSecret = randomBytes(32)
  const realizer = createPresetRealizer({
    catalog,
    source: (botId) => table.get(botId),
    botIds,
    allowedHostTools: new Set(config.allowedHostTools),
    web: webComposition,
    environment: environments,
    seal: (revision) => createHmac("sha256", filesSecret).update(revision).digest("hex"),
    register: (preset) => host.agentPresets.register(preset),
    diagnose: async (presetId) => (await host.agentPresets.resolve(presetId)).broken,
    later,
    warn,
  })
  ctx.effect(() => () => realizer.dispose(), "bot-core: bot presets")
  const registered = realizer.refreshAll()
  ctx.effect(() => {
    let offered = JSON.stringify(webComposition())
    return webState.subscribe(() => {
      const next = JSON.stringify(webComposition())
      if (next === offered) return
      offered = next
      void realizer.refreshAll()
    })
  }, "bot-core: web lookup of bot presets")
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
  ctx.effect(
    () => environments.subscribe((botId) => void realizer.refresh(botId, { retry: true })),
    "bot-core: bot environment changes",
  )

  const greeting = config.greeting.trim().length > 0 ? config.greeting : DEFAULT_GREETING

  const renameMain = async (sessionId: string, title: string) => {
    await services.sessionController.rename({ sessionId, title })
  }

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

  await registry.migrateTimezones(() => new Intl.DateTimeFormat().resolvedOptions().timeZone)

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

  const prepareSession = (sessionId: string, work: () => Promise<unknown>) => {
    preparations.run(sessionId, work).catch((error: unknown) => {
      warn(`bot-core: could not prepare session "${sessionId}": ${String(error)}`)
    })
  }

  const createMainSession = async (bot: { id: string; name: string }) => {
    const { main } = modelStore.get(bot.id).models
    const { sessionId } = await sessions.create(bot.id, { title: bot.name })
    await modelStore.markApplied(bot.id, main)
    return sessionId
  }
  startMain = createMainSession
  openMain = (bot) => {
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

  const sessionOf = createSessionIdentity<LiveAgent>({
    isBot: (botId) => realizer.isBot(botId),
    recorded: (sessionId) => registry.botOfSession(sessionId),
    agent: (sessionId) => host.agents.get(sessionId),
  })
  const sessionBotOf = (agent: LiveAgent) => botOfIdentity(sessionOf(agent))
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
  const shieldContext = <T>(botId: string, value: T, tool?: string) =>
    vaultGuard.shield({ botId, ...(tool === undefined ? {} : { tool }) }, "bot-context", value)
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

  let reconcileContinued: (sessionId: string) => void = () => {}

  events.on("agent/created", async ({ agent }: { agent: LiveAgent }) => {
    isolation.created(agent)
    pinPermission(agent)
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
    const mainOf = registry.botOfMain(agent.id)?.id
    if (mainOf !== undefined) {
      const applied = mainModels.apply(mainOf).catch((error: unknown) => {
        warn(`bot-core: could not apply the main model of bot "${mainOf}": ${String(error)}`)
      })
      await Promise.race([applied, sleep(MAIN_MODEL_WAIT_MS)])
    }
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
  isolation.resync()
  for (const agent of host.agents.list()) repinPermission(agent)
  for (const botId of botIds()) applyMainModel(botId)

  const fsOf = (agent: LiveAgent, botId: string): EnvironmentFs | undefined => {
    const wanted = botPresetId(botId)
    const preset = presetOf(agent)
    if (preset !== undefined) {
      return preset === wanted ? host.agentPresets.serviceFor(agent, "fs") : undefined
    }
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

  ctx.effect(
    () =>
      registry.subscribe(() => {
        void realizer.refreshAll()
        void environments.sync()
      }),
    "bot-core: bot preset sync",
  )

  for (const [id, record] of table.entries()) {
    if (record.mainSessionId !== undefined && !mainOnBotPreset(record)) {
      warn(
        `bot-core: the Main session of bot "${record.name}" (${id}) predates bot presets; it runs the deployment's default Agent preset outside the bot's environment, so it is locked down (no tool runs) and cannot be moved onto the bot preset. Sessions started from the bot (Bot.createSession, the bot's New session) use the bot preset.`,
      )
    }
  }

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

  const allowedPlugins = () => {
    const names = new Set(config.allowedPlugins)
    for (const template of catalog.list()) pluginNamesOf(template.plugins, names)
    return names
  }
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
  const notesPlaceOf = (botId: string, token: string): NotesPlace | undefined => {
    const fs = environmentServices.get(botId, token)?.fs()
    const workspace = environments.current()?.workspace
    return fs === undefined || workspace === undefined
      ? undefined
      : { fs: fs as NotesFileSystem, workspace }
  }
  const newNoteId = () => uuidv7(Date.now(), randomBytes(10))
  const reviewSessions = createReviewSessions()
  const curatorSessions = createCuratorSessions()
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
  const placeWorkspaceFiles = async (botId: string) => {
    const signal = AbortSignal.timeout(WORKSPACE_FILES_TIMEOUT_MS)
    for (const placement of initialPlacements) {
      await placement.ensure(botId, signal).catch((error: unknown) => {
        warn(`bot-core: could not place ${placement.what} of bot "${botId}": ${String(error)}`)
      })
    }
  }
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

  const channelCatalog = createChannelCatalog()
  const welcomeChannels = createWelcomeChannels({ catalog: channelCatalog })
  ctx.effect(() => () => welcomeChannels.dispose(), "bot-core: the welcome guide's channels")
  let interactionOpened: (sessionId: string, interaction: BotInteraction) => void = () => {}
  let managedWorkspaceBot: (sessionId: string) => string | undefined = () => undefined
  let mainAnsweredWorkspace: (sessionId: string) => string | undefined = () => undefined
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
  const skillsDomain = await services.storageDomain.open(SKILLS_DOMAIN)
  ctx.effect(() => () => void skillsDomain.close(), "bot-core: skills storage domain")
  const skillStore = createSkillStore({
    skillHistory: skillsDomain.table("history"),
    skillUsage: skillsDomain.table("usage"),
    skillSettings: skillsDomain.table("settings"),
    skillMarks: skillsDomain.table("marks"),
    skillCuration: skillsDomain.table("curation"),
  })
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
  const shownAs = (agentId: string) => reviewSessions.get(agentId)?.sessionId ?? agentId

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

  let channelStatus: (botId: string) => readonly BotStatusChannel[] = () => []

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
      held: createHeldReplies(),
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
