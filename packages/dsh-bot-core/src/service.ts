import { type Context, Service } from "@deepseek-ai/cordis"
import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"
import {
  BOT_SERVICE,
  type Bot,
  type BotChannel,
  type BotConnectionProvider,
  type BotConnector,
  type BotEnvironment,
  type BotEnvironmentInfo,
  type BotPresetChange,
  type BotSessionOptions,
} from "./contract"
import type { ChannelCatalog } from "./host/channels/catalog"
import type { ConnectionProviders } from "./host/connections/providers"
import type { EnvironmentKeeper } from "./host/environment"
import type { TemplateCatalog } from "./host/preset/types"
import type { BotRegistry } from "./host/registry"
import {
  ATTACH_COMPACTION,
  ATTACH_ENVIRONMENT_SERVICES,
  type AttachCompaction,
  type AttachEnvironmentServices,
  type BotCompactor,
  type BotEnvironmentServices,
  CALL_CONNECTOR_TOOL,
  CALL_CONVERSATION_TOOL,
  CALL_NOTE_TOOL,
  CALL_PEER_TOOL,
  CALL_SCHEDULE_TOOL,
  CALL_SESSION_TOOL,
  CALL_SETTINGS_TOOL,
  CALL_SKILL_TOOL,
  type CallConnectorTool,
  type CallConversationTool,
  type CallNoteTool,
  type CallPeerTool,
  type CallScheduleTool,
  type CallSessionTool,
  type CallSettingsTool,
  type CallSkillTool,
  type ChannelSilenceRequest,
  type ChannelSilenceResult,
  CONNECTOR_TOOL_AVAILABLE,
  CONVERSATION_TOOLS_AVAILABLE,
  type ConnectorToolAvailable,
  type ConnectorToolDescription,
  type ConnectorToolRequest,
  type ConnectorToolResponse,
  type ConversationToolRequest,
  type ConversationToolsAvailable,
  CREDENTIALS_AVAILABLE,
  type CredentialsAvailable,
  DESCRIBE_PROMPT,
  type DescribePrompt,
  GUARD_TOOL_ARGUMENTS,
  GUARD_TOOL_RESULT,
  type GuardArgumentsRequest,
  type GuardResultRequest,
  type GuardToolArguments,
  type GuardToolResult,
  LIST_CREDENTIALS,
  LIST_SKILLS,
  type ListCredentials,
  type ListSkills,
  LOAD_SKILL,
  type LoadSkill,
  type NoteStepRequest,
  type NoteToolRequest,
  PEER_TOOL_AVAILABLE,
  type PeerToolAvailable,
  type PeerToolRequest,
  type PeerToolResponse,
  PINNED_NOTES,
  type PinnedNotes,
  PREPARE_NOTES,
  PREPARE_SKILLS,
  type PrepareNotes,
  type PrepareSkills,
  SCHEDULE_TOOL_AVAILABLE,
  type ScheduleToolAvailable,
  type ScheduleToolName,
  type ScheduleToolRequest,
  type ScheduleToolResponse,
  SESSION_TOOLS_AVAILABLE,
  SETTINGS_TOOL_AVAILABLE,
  type SessionToolRequest,
  type SessionToolResponse,
  type SessionToolsAvailable,
  type SettingsToolAvailable,
  type SettingsToolCall,
  SKILL_TOOL_AVAILABLE,
  type SkillToolAvailable,
  type SkillToolRequest,
  STAY_CHANNEL_SILENT,
  type StayChannelSilent,
  WATCH_CONNECTOR_TOOLS,
  WATCH_SKILLS,
  type WatchConnectorTools,
  type WatchSkills,
  WEB_FETCH,
  WEB_READY,
  WEB_SEARCH,
  type WebOperation,
  type WebReady,
} from "./internal"
import type { MainPreparation } from "./mains-contract"
import type { BotSettingsArea } from "./settings-contract"
import type { BotView } from "./shared/bots"
import type { BotChannelField } from "./shared/channels"
import type {
  BotConnectorChange,
  BotConnectorView,
  ConnectorAction,
  ConnectorActionChange,
  ConnectorPermissionChange,
  ConnectorToolPermission,
} from "./shared/connectors"
import type {
  BotModelCatalog,
  BotModelChoice,
  BotModelSelection,
  BotModelsChange,
  BotModelsView,
} from "./shared/models"
import type { BotPresetPreview, BotPresetState, BotTemplate } from "./shared/preset"
import type { BotWebStatus } from "./shared/web"
import { VAULT_KIT } from "./vault-bytes"
import type { BotVaultProvider, VaultKit } from "./vault-contract"
import type { BotWebBackend } from "./web-contract"

export interface BotBackend {
  readonly registry: Pick<BotRegistry, "list">
  readonly botIds: () => Iterable<string>
  readonly channels: Pick<ChannelCatalog, "register" | "list">
  readonly templates: Pick<TemplateCatalog, "register" | "list">
  readonly presetOf: (botId: string) => BotPresetState | undefined
  readonly onPresetChange: (listener: (botId: string) => void) => () => void
  readonly previewPreset: (botId: string, change: BotPresetChange) => BotPresetPreview
  readonly configurePreset: (botId: string, change: BotPresetChange) => Promise<BotPresetState>
  readonly createSession: (
    botId: string,
    options?: BotSessionOptions,
  ) => Promise<{ sessionId: string }>
  readonly models: BotModelsBackend
  readonly environments: Pick<EnvironmentKeeper, "register" | "current">
  readonly environmentServices: { readonly attach: AttachEnvironmentServices }
  readonly compactors: { readonly attach: AttachCompaction }
  readonly mainPreparations: { register(preparation: MainPreparation): () => void }
  readonly connectors: BotConnectorsBackend
  readonly connectionProviders: Pick<ConnectionProviders, "register" | "list">
  readonly stayChannelSilent: StayChannelSilent
  readonly schedules: BotSchedulesBackend
  readonly managedSessions: BotManagedSessionsBackend
  readonly peers: BotPeersBackend
  readonly web: BotWebLookupBackend
  readonly describePrompt: DescribePrompt
  readonly notes: BotNotesBackend
  readonly skills: BotSkillsBackend
  readonly conversations: BotConversationsBackend
  readonly vaults: BotVaultsBackend
  readonly settings: BotSettingsBackend
}

export interface BotSettingsBackend {
  register(area: BotSettingsArea): () => void
  list(): readonly BotSettingsArea[]
  readonly available: SettingsToolAvailable
  readonly call: CallSettingsTool
}

export interface BotVaultsBackend {
  register(provider: BotVaultProvider): () => void
  list(): readonly BotVaultProvider[]
  readonly guardArguments: GuardToolArguments
  readonly guardResult: GuardToolResult
  readonly credentialsAvailable: CredentialsAvailable
  readonly listCredentials: ListCredentials
}

export interface BotConversationsBackend {
  readonly available: ConversationToolsAvailable
  readonly call: CallConversationTool
}

export interface BotSkillsBackend {
  readonly available: SkillToolAvailable
  readonly call: CallSkillTool
  readonly prepare: PrepareSkills
  readonly list: ListSkills
  readonly load: LoadSkill
  readonly watch: WatchSkills
}

export interface BotNotesBackend {
  readonly call: CallNoteTool
  readonly prepare: PrepareNotes
  readonly pinned: PinnedNotes
}

export interface BotModelsBackend {
  view(botId: string): BotModelsView
  configure(botId: string, change: unknown): Promise<BotModelsView>
  catalog(): Promise<BotModelCatalog>
  resolve(choice: BotModelChoice): Promise<BotModelSelection>
  subscribe(listener: (botId: string) => void): () => void
}

export interface BotWebLookupBackend {
  register(backend: BotWebBackend): () => void
  list(): readonly BotWebBackend[]
  status(): BotWebStatus
  subscribe(listener: () => void): () => void
  readonly ready: WebReady
  readonly search: WebOperation<WebSearchRequest, WebSearchResult>
  readonly fetch: WebOperation<WebFetchRequest, WebFetchResult>
}

export interface BotSchedulesBackend {
  readonly available: ScheduleToolAvailable
  readonly call: CallScheduleTool
}

export interface BotPeersBackend {
  readonly available: PeerToolAvailable
  readonly call: CallPeerTool
}

export interface BotManagedSessionsBackend {
  readonly available: SessionToolsAvailable
  readonly call: CallSessionTool
}

export interface BotConnectorsBackend {
  register(connector: BotConnector<unknown>): () => void
  list(): readonly BotConnector<unknown>[]
  states(botId: string): readonly BotConnectorView[]
  configure(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView>
  retry(botId: string, connectorId: string): BotConnectorView
  onStateChange(listener: (botId: string) => void): () => void
  permissions(botId: string): readonly ConnectorToolPermission[]
  setPermission(
    botId: string,
    change: ConnectorPermissionChange,
  ): Promise<readonly ConnectorToolPermission[]>
  actions(botId: string): readonly ConnectorAction[]
  subscribe(listener: (change: ConnectorActionChange) => void): () => void
  watchTools: WatchConnectorTools
  toolAvailable: ConnectorToolAvailable
  callTool: CallConnectorTool
}

const BACKEND = Symbol("botBackend")

export class BotService extends Service implements Bot {
  readonly [BACKEND]: BotBackend

  constructor(ctx: Context, backend: BotBackend) {
    super(ctx, BOT_SERVICE)
    this[BACKEND] = backend
  }

  bots(): readonly BotView[] {
    return this[BACKEND].registry.list()
  }

  botIds(): readonly string[] {
    return [...this[BACKEND].botIds()]
  }

  registerChannel<F extends readonly BotChannelField[]>(channel: BotChannel<F>): () => void {
    return this[BACKEND].channels.register(channel)
  }

  channels(): readonly BotChannel[] {
    return this[BACKEND].channels.list()
  }

  registerConnector<A>(connector: BotConnector<A>): () => void {
    return this[BACKEND].connectors.register(connector as BotConnector<unknown>)
  }

  connectors(): readonly BotConnector<unknown>[] {
    return this[BACKEND].connectors.list()
  }

  registerConnectionProvider(provider: BotConnectionProvider): () => void {
    return this[BACKEND].connectionProviders.register(provider)
  }

  connectionProviders(): readonly BotConnectionProvider[] {
    return this[BACKEND].connectionProviders.list()
  }

  connectorStates(botId: string): readonly BotConnectorView[] {
    return this[BACKEND].connectors.states(botId)
  }

  configureConnector(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView> {
    return this[BACKEND].connectors.configure(botId, connectorId, change)
  }

  retryConnector(botId: string, connectorId: string): BotConnectorView {
    return this[BACKEND].connectors.retry(botId, connectorId)
  }

  onConnectorStateChange(listener: (botId: string) => void): () => void {
    return this[BACKEND].connectors.onStateChange(listener)
  }

  connectorPermissions(botId: string): readonly ConnectorToolPermission[] {
    return this[BACKEND].connectors.permissions(botId)
  }

  setConnectorPermission(
    botId: string,
    change: ConnectorPermissionChange,
  ): Promise<readonly ConnectorToolPermission[]> {
    return this[BACKEND].connectors.setPermission(botId, change)
  }

  connectorActions(botId: string): readonly ConnectorAction[] {
    return this[BACKEND].connectors.actions(botId)
  }

  onConnectorActionChange(listener: (change: ConnectorActionChange) => void): () => void {
    return this[BACKEND].connectors.subscribe(listener)
  }

  registerTemplate(template: BotTemplate): () => void {
    return this[BACKEND].templates.register(template)
  }

  templates(): readonly BotTemplate[] {
    return this[BACKEND].templates.list()
  }

  presetOf(botId: string): BotPresetState | undefined {
    return this[BACKEND].presetOf(botId)
  }

  onPresetChange(listener: (botId: string) => void): () => void {
    return this[BACKEND].onPresetChange(listener)
  }

  previewPreset(botId: string, change: BotPresetChange): BotPresetPreview {
    return this[BACKEND].previewPreset(botId, change)
  }

  configurePreset(botId: string, change: BotPresetChange): Promise<BotPresetState> {
    return this[BACKEND].configurePreset(botId, change)
  }

  createSession(botId: string, options?: BotSessionOptions): Promise<{ sessionId: string }> {
    return this[BACKEND].createSession(botId, options)
  }

  models(botId: string): BotModelsView {
    return this[BACKEND].models.view(botId)
  }

  configureModels(botId: string, change: BotModelsChange): Promise<BotModelsView> {
    return this[BACKEND].models.configure(botId, change)
  }

  modelCatalog(): Promise<BotModelCatalog> {
    return this[BACKEND].models.catalog()
  }

  resolveModel(choice: BotModelChoice): Promise<BotModelSelection> {
    return this[BACKEND].models.resolve(choice)
  }

  onModelsChange(listener: (botId: string) => void): () => void {
    return this[BACKEND].models.subscribe(listener)
  }

  registerEnvironment(environment: BotEnvironment): () => void {
    return this[BACKEND].environments.register(environment)
  }

  [ATTACH_ENVIRONMENT_SERVICES](
    botId: string,
    token: string,
    services: BotEnvironmentServices,
  ): () => void {
    return this[BACKEND].environmentServices.attach(botId, token, services)
  }

  [ATTACH_COMPACTION](botId: string, token: string, compactor: BotCompactor): () => void {
    return this[BACKEND].compactors.attach(botId, token, compactor)
  }

  registerMainPreparation(preparation: MainPreparation): () => void {
    return this[BACKEND].mainPreparations.register(preparation)
  }

  [WATCH_CONNECTOR_TOOLS](
    botId: string,
    token: string,
    listener: (tools: readonly ConnectorToolDescription[]) => void,
  ): () => void {
    return this[BACKEND].connectors.watchTools(botId, token, listener)
  }

  [CONNECTOR_TOOL_AVAILABLE](botId: string, token: string, agentId: string, name: string): boolean {
    return this[BACKEND].connectors.toolAvailable(botId, token, agentId, name)
  }

  [CALL_CONNECTOR_TOOL](
    botId: string,
    token: string,
    request: ConnectorToolRequest,
    signal: AbortSignal,
  ): Promise<ConnectorToolResponse> {
    return this[BACKEND].connectors.callTool(botId, token, request, signal)
  }

  [STAY_CHANNEL_SILENT](
    botId: string,
    token: string,
    request: ChannelSilenceRequest,
  ): ChannelSilenceResult {
    return this[BACKEND].stayChannelSilent(botId, token, request)
  }

  [SCHEDULE_TOOL_AVAILABLE](
    botId: string,
    token: string,
    agentId: string,
    tool: ScheduleToolName,
  ): boolean {
    return this[BACKEND].schedules.available(botId, token, agentId, tool)
  }

  [CALL_SCHEDULE_TOOL](
    botId: string,
    token: string,
    request: ScheduleToolRequest,
  ): Promise<ScheduleToolResponse> {
    return this[BACKEND].schedules.call(botId, token, request)
  }

  [SESSION_TOOLS_AVAILABLE](botId: string, token: string, agentId: string): boolean {
    return this[BACKEND].managedSessions.available(botId, token, agentId)
  }

  [CALL_SESSION_TOOL](
    botId: string,
    token: string,
    request: SessionToolRequest,
  ): Promise<SessionToolResponse> {
    return this[BACKEND].managedSessions.call(botId, token, request)
  }

  [PEER_TOOL_AVAILABLE](botId: string, token: string, agentId: string): boolean {
    return this[BACKEND].peers.available(botId, token, agentId)
  }

  [CALL_PEER_TOOL](
    botId: string,
    token: string,
    request: PeerToolRequest,
  ): Promise<PeerToolResponse> {
    return this[BACKEND].peers.call(botId, token, request)
  }

  registerWebBackend(backend: BotWebBackend): () => void {
    return this[BACKEND].web.register(backend)
  }

  webBackends(): readonly BotWebBackend[] {
    return this[BACKEND].web.list()
  }

  webStatus(): BotWebStatus {
    return this[BACKEND].web.status()
  }

  onWebChange(listener: () => void): () => void {
    return this[BACKEND].web.subscribe(listener)
  }

  [WEB_READY](botId: string, token: string, capability: "search" | "fetch"): Promise<boolean> {
    return this[BACKEND].web.ready(botId, token, capability)
  }

  [WEB_SEARCH](botId: string, token: string, request: WebSearchRequest, signal: AbortSignal) {
    return this[BACKEND].web.search(botId, token, request, signal)
  }

  [WEB_FETCH](botId: string, token: string, request: WebFetchRequest, signal: AbortSignal) {
    return this[BACKEND].web.fetch(botId, token, request, signal)
  }

  [DESCRIBE_PROMPT](botId: string, token: string, agentId: string) {
    return this[BACKEND].describePrompt(botId, token, agentId)
  }

  [CALL_NOTE_TOOL](botId: string, token: string, request: NoteToolRequest, signal: AbortSignal) {
    return this[BACKEND].notes.call(botId, token, request, signal)
  }

  [PREPARE_NOTES](botId: string, token: string, request: NoteStepRequest, signal: AbortSignal) {
    return this[BACKEND].notes.prepare(botId, token, request, signal)
  }

  [SKILL_TOOL_AVAILABLE](botId: string, token: string, agentId: string) {
    return this[BACKEND].skills.available(botId, token, agentId)
  }

  [CALL_SKILL_TOOL](botId: string, token: string, request: SkillToolRequest, signal: AbortSignal) {
    return this[BACKEND].skills.call(botId, token, request, signal)
  }

  [PREPARE_SKILLS](botId: string, token: string, agentId: string, signal: AbortSignal) {
    return this[BACKEND].skills.prepare(botId, token, agentId, signal)
  }

  [LIST_SKILLS](botId: string, token: string, signal: AbortSignal) {
    return this[BACKEND].skills.list(botId, token, signal)
  }

  [LOAD_SKILL](botId: string, token: string, name: string, signal: AbortSignal) {
    return this[BACKEND].skills.load(botId, token, name, signal)
  }

  [WATCH_SKILLS](botId: string, token: string, listener: () => void) {
    return this[BACKEND].skills.watch(botId, token, listener)
  }

  [CONVERSATION_TOOLS_AVAILABLE](botId: string, token: string, agentId: string) {
    return this[BACKEND].conversations.available(botId, token, agentId)
  }

  [CALL_CONVERSATION_TOOL](
    botId: string,
    token: string,
    request: ConversationToolRequest,
    signal: AbortSignal,
  ) {
    return this[BACKEND].conversations.call(botId, token, request, signal)
  }

  [PINNED_NOTES](botId: string, token: string, agentId: string) {
    return this[BACKEND].notes.pinned(botId, token, agentId)
  }

  registerVaultProvider(provider: BotVaultProvider): () => void {
    return this[BACKEND].vaults.register(provider)
  }

  vaultProviders(): readonly BotVaultProvider[] {
    return this[BACKEND].vaults.list()
  }

  vaultKit(): VaultKit {
    return VAULT_KIT
  }

  [GUARD_TOOL_ARGUMENTS](botId: string, token: string, request: GuardArgumentsRequest) {
    return this[BACKEND].vaults.guardArguments(botId, token, request)
  }

  [GUARD_TOOL_RESULT](botId: string, token: string, request: GuardResultRequest) {
    return this[BACKEND].vaults.guardResult(botId, token, request)
  }

  [CREDENTIALS_AVAILABLE](botId: string, token: string, agentId: string) {
    return this[BACKEND].vaults.credentialsAvailable(botId, token, agentId)
  }

  [LIST_CREDENTIALS](botId: string, token: string, agentId: string, signal: AbortSignal) {
    return this[BACKEND].vaults.listCredentials(botId, token, agentId, signal)
  }

  registerSettingsArea(area: BotSettingsArea): () => void {
    return this[BACKEND].settings.register(area)
  }

  settingsAreas(): readonly BotSettingsArea[] {
    return this[BACKEND].settings.list()
  }

  [SETTINGS_TOOL_AVAILABLE](botId: string, token: string, agentId: string) {
    return this[BACKEND].settings.available(botId, token, agentId)
  }

  [CALL_SETTINGS_TOOL](
    botId: string,
    token: string,
    request: SettingsToolCall,
    signal: AbortSignal,
  ) {
    return this[BACKEND].settings.call(botId, token, request, signal)
  }

  environment(): BotEnvironmentInfo | undefined {
    const current = this[BACKEND].environments.current()
    return current === undefined
      ? undefined
      : Object.freeze({
          id: current.id,
          isolate: Object.freeze([...current.isolate]),
          workspace: current.workspace,
        })
  }
}
