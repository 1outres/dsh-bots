import type { Context } from "@deepseek-ai/cordis"
import { Remote, type RemoteStream, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"
import type {
  BotAccepted,
  BotCreateInput,
  BotCreationOffer,
  BotsApi,
  BotsSnapshot,
  BotUpdateInput,
  BotView,
} from "../shared/bots"
import type {
  BotChannelChange,
  BotChannelCheck,
  BotChannelConfigureResult,
  BotChannelInspection,
  BotChannelOptions,
  BotChannelSettingsRef,
  BotChannelsApi,
  BotChannelsSnapshot,
} from "../shared/channels"
import type {
  BotConnectionsApi,
  BotConnectionsSnapshot,
  ConnectionAuthorization,
  ConnectionAuthorizeRequest,
  ConnectionProviderView,
  ConnectionRemoval,
  ConnectionView,
  OAuthClientChange,
} from "../shared/connections"
import type {
  BotConnectorActionsApi,
  BotConnectorActionsSnapshot,
  BotConnectorChange,
  BotConnectorStreamsApi,
  BotConnectorsApi,
  BotConnectorsSnapshot,
  BotConnectorView,
  ConnectorDecision,
  ConnectorDecisionResult,
  ConnectorJson,
  ConnectorPermissionChange,
  ConnectorWaitingSnapshot,
} from "../shared/connectors"
import type {
  BotEnvironmentApi,
  BotEnvironmentSpec,
  BotEnvironmentView,
} from "../shared/environment"
import type {
  BotEnvironmentHostApi,
  BotEnvironmentHostState,
  CustomConnectRequest,
  CustomCredential,
  CustomPreview,
} from "../shared/environment-host"
import type {
  BotByteReadOptions,
  BotDirectoryListing,
  BotFileBytes,
  BotFileRange,
  BotFileSearchRequest,
  BotFileSearchResult,
  BotFileStat,
  BotFileText,
} from "../shared/files"
import type { BotFilesApi } from "../shared/files-api"
import type {
  BotAnswerResult,
  BotInteractionAnswer,
  BotInteractionsApi,
  BotInteractionsSnapshot,
} from "../shared/interactions"
import type {
  BotMainViewApi,
  MainTimelineCursor,
  MainTimelineFrame,
  MainTimelineImageData,
  MainTimelinePage,
} from "../shared/main-view"
import type {
  BotMainsApi,
  BotMainsView,
  MainRotationOutcome,
  MainRotationOverride,
  MainRotationSettings,
} from "../shared/mains"
import type {
  BotManagedAnswerer,
  BotManagedSession,
  BotManagedSessionsApi,
  BotManagedSessionsSnapshot,
} from "../shared/managed-sessions"
import type { BotModelCatalog, BotModelsChange, BotModelsView } from "../shared/models"
import type {
  BotNotesApi,
  BotNotesStatus,
  NoteDocument,
  NoteFilter,
  NoteListing,
  NoteMonth,
  NoteSearch,
} from "../shared/notes"
import type {
  BotOnboardingApi,
  BotOnboardingView,
  BotWelcomeChannelSetup,
} from "../shared/onboarding"
import type {
  BotGroupChange,
  BotGroupInput,
  BotGroupJoin,
  BotGroupsApi,
  BotGroupsSnapshot,
  BotGroupView,
  BotPeerMessagePage,
} from "../shared/peers"
import type { RemoteNamespace } from "../shared/remote-contract"
import type {
  BotSenderInquiriesSnapshot,
  BotSendersApi,
  BotSendersSnapshot,
  SenderAnswerResult,
  SenderChoice,
  SenderMatch,
  SenderPolicyView,
  SenderRecipientsView,
  SenderRuleChange,
  SenderUnknown,
  SenderWaitingSnapshot,
} from "../shared/senders"
import type {
  BotSettingRevertResult,
  BotSettingsApi,
  BotSettingsHistoryView,
} from "../shared/settings"
import type { BotSkillHistory, BotSkillsApi, BotSkillsView, SkillVersion } from "../shared/skills"
import type {
  BotVaultsApi,
  BotVaultsSnapshot,
  BotVaultView,
  VaultAccountRequest,
  VaultAccountView,
  VaultGrantChange,
  VaultGrantRequest,
  VaultGrantView,
  VaultIncidentView,
  VaultItemView,
} from "../shared/vaults"
import type {
  BotWebApi,
  BotWebCapability,
  BotWebSecretChange,
  BotWebTestResult,
  BotWebView,
} from "../shared/web"
import type {
  BotWorkspaceGrant,
  BotWorkspaceOptions,
  BotWorkspaceSettings,
  BotWorkspaceSettingsChange,
  BotWorkspacesApi,
  BotWorkspacesSnapshot,
} from "../shared/workspaces"
import type { ChannelPanel } from "./channels/panel"
import type { ConnectionPanel } from "./connections/panel"
import type { ConnectorApprovals } from "./connectors/approvals"
import type { ConnectorPanel } from "./connectors/panel"
import type { ConnectorStreams } from "./connectors/streams"
import type { EnvironmentHostPanel } from "./environment-host/panel"
import type { EnvironmentPanel } from "./environment-spec/panel"
import type { BotFiles } from "./files"
import type { InteractionPanel } from "./interactions/panel"
import type { BotLifecycle } from "./lifecycle"
import type { MainView } from "./main-view/panel"
import type { MainPanel } from "./mains/panel"
import type { ManagedPanel } from "./managed/panel"
import type { WorkspacesPanel } from "./managed/workspaces-panel"
import { type ModelPanel, remoteModelsError } from "./models/panel"
import type { NotesPanel } from "./notes/panel"
import type { OnboardingPanel } from "./onboarding/panel"
import type { PeerPanel } from "./peers/panel"
import type { BotRegistry } from "./registry"
import type { SenderAnswers } from "./senders/answers"
import type { SenderPanel } from "./senders/panel"
import type { SettingsPanel } from "./settings/panel"
import type { SkillPanel } from "./skills/panel"
import { watchStream } from "./stream"
import type { VaultPanel } from "./vaults/panel"
import type { WebPanel } from "./web/panel"

export const BOTS_REMOTE = "bots" satisfies RemoteNamespace

export interface BotsBackend {
  readonly lifecycle: BotLifecycle
  readonly update: BotRegistry["update"]
  readonly creationOptions: () => Promise<BotCreationOffer>
  readonly createSession: (botId: string) => Promise<{ sessionId: string }>
  readonly models: ModelPanel
}

const BACKEND = Symbol("botsBackend")

const ACCEPTED: BotAccepted = { accepted: true }

export class BotsRemoteService extends TypertRemoteService implements BotsApi {
  [BACKEND]: BotsBackend

  constructor(ctx: Context, backend: BotsBackend) {
    super(ctx, BOTS_REMOTE)
    this[BACKEND] = backend
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotsSnapshot> {
    const { lifecycle } = this[BACKEND]
    yield* watchStream(
      () => lifecycle.snapshot(),
      (listener) => lifecycle.subscribe(listener),
      signal,
    )
  }

  @Remote
  async create(input: BotCreateInput): Promise<{ id: string }> {
    try {
      return { id: await this[BACKEND].lifecycle.create(input) }
    } catch (error) {
      throw remoteModelsError(error)
    }
  }

  @Remote
  async creationOptions(): Promise<BotCreationOffer> {
    return this[BACKEND].creationOptions()
  }

  @Remote
  async retryCreate(id: string): Promise<BotAccepted> {
    await this[BACKEND].lifecycle.retryCreate(id)
    return ACCEPTED
  }

  @Remote
  async discardCreate(id: string): Promise<BotAccepted> {
    await this[BACKEND].lifecycle.discardCreate(id)
    return ACCEPTED
  }

  @Remote
  update(id: string, input: BotUpdateInput): Promise<BotView> {
    return this[BACKEND].update(id, input)
  }

  @Remote
  createSession(botId: string): Promise<{ sessionId: string }> {
    return this[BACKEND].createSession(botId)
  }

  @Remote
  async models(id: string): Promise<BotModelsView> {
    return this[BACKEND].models.view(id)
  }

  @Remote({ mode: "stream" })
  async *watchModels(id: string, signal?: AbortSignal): AsyncIterable<BotModelsView> {
    const { models } = this[BACKEND]
    models.view(id)
    yield* watchStream(
      () => models.view(id),
      (listener) => models.subscribe((botId) => botId === id && listener()),
      signal,
    )
  }

  @Remote
  configureModels(id: string, change: BotModelsChange): Promise<BotModelsView> {
    return this[BACKEND].models.configure(id, change)
  }

  @Remote
  modelCatalog(): Promise<BotModelCatalog> {
    return this[BACKEND].models.catalog()
  }

  @Remote
  async removeBot(id: string): Promise<BotAccepted> {
    await this[BACKEND].lifecycle.remove(id)
    return ACCEPTED
  }

  @Remote
  async retryRemove(id: string): Promise<BotAccepted> {
    await this[BACKEND].lifecycle.retryRemove(id)
    return ACCEPTED
  }

  @Remote
  async dismissRemove(id: string): Promise<BotAccepted> {
    await this[BACKEND].lifecycle.dismissRemove(id)
    return ACCEPTED
  }
}

export const BOT_FILES_REMOTE = "botFiles" satisfies RemoteNamespace

const FILES = Symbol("botFiles")

export class BotFilesRemoteService extends TypertRemoteService implements BotFilesApi {
  [FILES]: BotFiles

  constructor(ctx: Context, files: BotFiles) {
    super(ctx, BOT_FILES_REMOTE)
    this[FILES] = files
  }

  @Remote
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<BotFileStat> {
    return this[FILES].stat(sessionId, path, signal)
  }

  @Remote
  read(
    sessionId: string,
    path: string,
    range?: BotFileRange,
    signal?: AbortSignal,
  ): Promise<BotFileText> {
    return this[FILES].read(sessionId, path, range, signal)
  }

  @Remote
  readBytes(
    sessionId: string,
    path: string,
    options?: BotByteReadOptions,
    signal?: AbortSignal,
  ): Promise<BotFileBytes> {
    return this[FILES].readBytes(sessionId, path, options, signal)
  }

  @Remote
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<BotDirectoryListing> {
    return this[FILES].list(sessionId, path, signal)
  }

  @Remote
  search(
    sessionId: string,
    request: BotFileSearchRequest,
    signal?: AbortSignal,
  ): Promise<BotFileSearchResult> {
    return this[FILES].search(sessionId, request, signal)
  }
}

export const BOT_CHANNELS_REMOTE = "botChannels" satisfies RemoteNamespace

const PANEL = Symbol("botChannelPanel")
const WATCHED = Symbol("botChannelChanges")

export class BotChannelsRemoteService extends TypertRemoteService implements BotChannelsApi {
  [PANEL]: ChannelPanel;
  [WATCHED]: (listener: () => void) => () => void

  constructor(ctx: Context, panel: ChannelPanel, subscribe: (listener: () => void) => () => void) {
    super(ctx, BOT_CHANNELS_REMOTE)
    this[PANEL] = panel
    this[WATCHED] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotChannelsSnapshot> {
    const panel = this[PANEL]
    panel.snapshot(botId)
    yield* watchStream(() => panel.snapshot(botId), this[WATCHED], signal)
  }

  @Remote
  configure(
    botId: string,
    channelId: string,
    change: BotChannelChange,
  ): Promise<BotChannelConfigureResult> {
    return this[PANEL].configure(botId, channelId, change)
  }

  @Remote
  options(
    channelId: string,
    settings: BotChannelSettingsRef,
    source: string,
    signal?: AbortSignal,
  ): Promise<BotChannelOptions> {
    return this[PANEL].options(channelId, settings, source, signal)
  }

  @Remote
  inspect(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal?: AbortSignal,
  ): Promise<BotChannelInspection> {
    return this[PANEL].inspect(channelId, settings, signal)
  }

  @Remote
  check(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal?: AbortSignal,
  ): Promise<BotChannelCheck> {
    return this[PANEL].check(channelId, settings, signal)
  }
}

export const BOT_INTERACTIONS_REMOTE = "botInteractions" satisfies RemoteNamespace

const INTERACTIONS = Symbol("botInteractionPanel")
const INTERACTION_CHANGES = Symbol("botInteractionChanges")

export class BotInteractionsRemoteService
  extends TypertRemoteService
  implements BotInteractionsApi
{
  [INTERACTIONS]: InteractionPanel;
  [INTERACTION_CHANGES]: (listener: () => void) => () => void

  constructor(
    ctx: Context,
    panel: InteractionPanel,
    subscribe: (listener: () => void) => () => void,
  ) {
    super(ctx, BOT_INTERACTIONS_REMOTE)
    this[INTERACTIONS] = panel
    this[INTERACTION_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotInteractionsSnapshot> {
    const panel = this[INTERACTIONS]
    panel.snapshot(sessionId)
    yield* watchStream(() => panel.snapshot(sessionId), this[INTERACTION_CHANGES], signal)
  }

  @Remote
  answer(
    sessionId: string,
    interactionId: string,
    answer: BotInteractionAnswer,
  ): Promise<BotAnswerResult> {
    return this[INTERACTIONS].answer(sessionId, interactionId, answer)
  }

  @Remote
  hold(sessionId: string, interactionId: string): Promise<BotAnswerResult> {
    return this[INTERACTIONS].hold(sessionId, interactionId)
  }
}

export const BOT_CONNECTORS_REMOTE = "botConnectors" satisfies RemoteNamespace

const CONNECTORS = Symbol("botConnectorPanel")

export class BotConnectorsRemoteService extends TypertRemoteService implements BotConnectorsApi {
  [CONNECTORS]: ConnectorPanel

  constructor(ctx: Context, panel: ConnectorPanel) {
    super(ctx, BOT_CONNECTORS_REMOTE)
    this[CONNECTORS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorsSnapshot> {
    const panel = this[CONNECTORS]
    panel.snapshot(botId)
    yield* watchStream(
      () => panel.snapshot(botId),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  configure(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView> {
    return this[CONNECTORS].configure(botId, connectorId, change)
  }

  @Remote
  setPermission(botId: string, change: ConnectorPermissionChange): Promise<BotConnectorView> {
    return this[CONNECTORS].setPermission(botId, change)
  }

  @Remote
  async retry(botId: string, connectorId: string): Promise<BotConnectorView> {
    return this[CONNECTORS].retry(botId, connectorId)
  }
}

export const BOT_CONNECTOR_ACTIONS_REMOTE = "botConnectorActions" satisfies RemoteNamespace

const APPROVALS = Symbol("botConnectorApprovals")

export class BotConnectorActionsRemoteService
  extends TypertRemoteService
  implements BotConnectorActionsApi
{
  [APPROVALS]: ConnectorApprovals

  constructor(ctx: Context, approvals: ConnectorApprovals) {
    super(ctx, BOT_CONNECTOR_ACTIONS_REMOTE)
    this[APPROVALS] = approvals
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotConnectorActionsSnapshot> {
    const approvals = this[APPROVALS]
    approvals.views(botId)
    yield* watchStream(
      () => ({ botId, actions: approvals.views(botId) }),
      (listener) => approvals.subscribe((action) => action.botId === botId && listener()),
      signal,
    )
  }

  @Remote({ mode: "stream" })
  async *watchWaiting(signal?: AbortSignal): AsyncIterable<ConnectorWaitingSnapshot> {
    const approvals = this[APPROVALS]
    yield* watchStream(
      () => ({ waiting: approvals.waiting() }),
      (listener) => approvals.subscribe(() => listener()),
      signal,
    )
  }

  @Remote
  decide(
    botId: string,
    actionId: string,
    decision: ConnectorDecision,
  ): Promise<ConnectorDecisionResult> {
    return this[APPROVALS].fromWeb(this.ctx.invocation?.peer.principal, botId, actionId, decision)
  }
}

export const BOT_CONNECTIONS_REMOTE = "botConnections" satisfies RemoteNamespace

const CONNECTIONS = Symbol("botConnectionPanel")

export class BotConnectionsRemoteService extends TypertRemoteService implements BotConnectionsApi {
  [CONNECTIONS]: ConnectionPanel

  constructor(ctx: Context, panel: ConnectionPanel) {
    super(ctx, BOT_CONNECTIONS_REMOTE)
    this[CONNECTIONS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotConnectionsSnapshot> {
    const panel = this[CONNECTIONS]
    yield* watchStream(
      () => panel.snapshot(),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  configureClient(provider: string, change: OAuthClientChange): Promise<ConnectionProviderView> {
    return this[CONNECTIONS].configureClient(this.ctx.invocation?.peer.principal, provider, change)
  }

  @Remote
  authorize(request: ConnectionAuthorizeRequest): Promise<ConnectionAuthorization> {
    return this[CONNECTIONS].authorize(this.ctx.invocation?.peer.principal, request)
  }

  @Remote
  rename(connectionId: string, label: string): Promise<ConnectionView> {
    return this[CONNECTIONS].rename(this.ctx.invocation?.peer.principal, connectionId, label)
  }

  @Remote
  assign(botId: string, connectionId: string, assigned: boolean): Promise<ConnectionView> {
    return this[CONNECTIONS].assign(
      this.ctx.invocation?.peer.principal,
      botId,
      connectionId,
      assigned,
    )
  }

  @Remote
  disconnect(connectionId: string): Promise<ConnectionRemoval> {
    return this[CONNECTIONS].disconnect(this.ctx.invocation?.peer.principal, connectionId)
  }
}

export const BOT_CONNECTOR_STREAMS_REMOTE = "botConnectorStreams" satisfies RemoteNamespace

const STREAMS = Symbol("botConnectorStreams")

export class BotConnectorStreamsRemoteService
  extends TypertRemoteService
  implements BotConnectorStreamsApi
{
  [STREAMS]: ConnectorStreams

  constructor(ctx: Context, streams: ConnectorStreams) {
    super(ctx, BOT_CONNECTOR_STREAMS_REMOTE)
    this[STREAMS] = streams
  }

  @Remote({ mode: "stream" })
  async *open(
    botId: string,
    connectorId: string,
    stream: string,
    signal?: AbortSignal,
  ): RemoteStream<ConnectorJson, ConnectorJson> {
    const invocation = this.ctx.invocation
    if (invocation === undefined)
      throw new Error("a connector's stream opens only from a Remote call")
    yield* this[STREAMS].open({
      caller: invocation.peer.principal,
      botId,
      connectorId,
      stream,
      uplink: invocation.uplink(),
      signal: signal ?? invocation.signal,
    })
  }
}

export const BOT_WEB_REMOTE = "botWeb" satisfies RemoteNamespace

const WEB = Symbol("botWebPanel")
const WEB_CHANGES = Symbol("botWebChanges")

export class BotWebRemoteService extends TypertRemoteService implements BotWebApi {
  [WEB]: WebPanel;
  [WEB_CHANGES]: (listener: () => void) => () => void

  constructor(ctx: Context, panel: WebPanel, subscribe: (listener: () => void) => () => void) {
    super(ctx, BOT_WEB_REMOTE)
    this[WEB] = panel
    this[WEB_CHANGES] = subscribe
  }

  @Remote
  async view(): Promise<BotWebView> {
    return this[WEB].view()
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotWebView> {
    const panel = this[WEB]
    yield* watchStream(() => panel.view(), this[WEB_CHANGES], signal)
  }

  @Remote
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebView> {
    return this[WEB].setEnabled(capability, enabled)
  }

  @Remote
  setSecret(key: string, change: BotWebSecretChange): Promise<BotWebView> {
    return this[WEB].setSecret(key, change)
  }

  @Remote
  test(): Promise<BotWebTestResult> {
    return this[WEB].test()
  }
}

export const BOT_MANAGED_SESSIONS_REMOTE = "botManagedSessions" satisfies RemoteNamespace

const MANAGED = Symbol("botManagedSessionsPanel")
const MANAGED_CHANGES = Symbol("botManagedSessionsChanges")

export class BotManagedSessionsRemoteService
  extends TypertRemoteService
  implements BotManagedSessionsApi
{
  [MANAGED]: ManagedPanel;
  [MANAGED_CHANGES]: (listener: () => void) => () => void

  constructor(ctx: Context, panel: ManagedPanel, subscribe: (listener: () => void) => () => void) {
    super(ctx, BOT_MANAGED_SESSIONS_REMOTE)
    this[MANAGED] = panel
    this[MANAGED_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotManagedSessionsSnapshot> {
    const panel = this[MANAGED]
    yield* watchStream(() => panel.snapshot(), this[MANAGED_CHANGES], signal)
  }

  @Remote
  entrust(botId: string, sessionId: string): Promise<BotManagedSession> {
    return this[MANAGED].entrust(botId, sessionId)
  }

  @Remote
  release(botId: string, sessionId: string): Promise<BotManagedSessionsSnapshot> {
    return this[MANAGED].release(botId, sessionId)
  }

  @Remote
  setAnswerer(
    botId: string,
    sessionId: string,
    answerer: BotManagedAnswerer,
  ): Promise<BotManagedSession> {
    return this[MANAGED].setAnswerer(botId, sessionId, answerer)
  }
}

export const BOT_WORKSPACES_REMOTE = "botWorkspaces" satisfies RemoteNamespace

const WORKSPACES = Symbol("botWorkspacesPanel")
const WORKSPACES_CHANGES = Symbol("botWorkspacesChanges")

export class BotWorkspacesRemoteService extends TypertRemoteService implements BotWorkspacesApi {
  [WORKSPACES]: WorkspacesPanel;
  [WORKSPACES_CHANGES]: (listener: () => void) => () => void

  constructor(
    ctx: Context,
    panel: WorkspacesPanel,
    subscribe: (listener: () => void) => () => void,
  ) {
    super(ctx, BOT_WORKSPACES_REMOTE)
    this[WORKSPACES] = panel
    this[WORKSPACES_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotWorkspacesSnapshot> {
    const panel = this[WORKSPACES]
    yield* watchStream(() => panel.snapshot(), this[WORKSPACES_CHANGES], signal)
  }

  @Remote
  options(): Promise<BotWorkspaceOptions> {
    return this[WORKSPACES].options()
  }

  @Remote
  grant(
    botId: string,
    workspaceId: string,
    settings: BotWorkspaceSettings,
  ): Promise<BotWorkspaceGrant> {
    return this[WORKSPACES].grant(botId, workspaceId, settings)
  }

  @Remote
  configure(
    botId: string,
    workspaceId: string,
    change: BotWorkspaceSettingsChange,
  ): Promise<BotWorkspaceGrant> {
    return this[WORKSPACES].configure(botId, workspaceId, change)
  }

  @Remote
  revoke(botId: string, workspaceId: string): Promise<BotWorkspacesSnapshot> {
    return this[WORKSPACES].revoke(botId, workspaceId)
  }
}

export const BOT_MAINS_REMOTE = "botMains" satisfies RemoteNamespace

const MAINS = Symbol("botMainPanel")
const MAINS_CHANGES = Symbol("botMainChanges")

export class BotMainsRemoteService extends TypertRemoteService implements BotMainsApi {
  [MAINS]: MainPanel;
  [MAINS_CHANGES]: (listener: () => void) => () => void

  constructor(ctx: Context, panel: MainPanel, subscribe: (listener: () => void) => () => void) {
    super(ctx, BOT_MAINS_REMOTE)
    this[MAINS] = panel
    this[MAINS_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watchDefaults(signal?: AbortSignal): AsyncIterable<MainRotationSettings> {
    const panel = this[MAINS]
    yield* watchStream(() => panel.defaults(), this[MAINS_CHANGES], signal)
  }

  @Remote
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings> {
    return this[MAINS].setDefaults(settings)
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotMainsView> {
    const panel = this[MAINS]
    panel.view(botId)
    yield* watchStream(() => panel.view(botId), this[MAINS_CHANGES], signal)
  }

  @Remote
  configure(botId: string, override: MainRotationOverride): Promise<BotMainsView> {
    return this[MAINS].configure(botId, override)
  }

  @Remote
  startNew(botId: string): Promise<MainRotationOutcome> {
    return this[MAINS].startNew(botId)
  }
}

export const BOT_MAIN_VIEW_REMOTE = "botMainView" satisfies RemoteNamespace

const MAIN_VIEW = Symbol("botMainView")

const unaborted = (signal: AbortSignal | undefined) => signal ?? new AbortController().signal

export class BotMainViewRemoteService extends TypertRemoteService implements BotMainViewApi {
  [MAIN_VIEW]: MainView

  constructor(ctx: Context, view: MainView) {
    super(ctx, BOT_MAIN_VIEW_REMOTE)
    this[MAIN_VIEW] = view
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<MainTimelineFrame> {
    yield* this[MAIN_VIEW].watch(botId, unaborted(signal))
  }

  @Remote
  page(botId: string, before: MainTimelineCursor, signal?: AbortSignal): Promise<MainTimelinePage> {
    return this[MAIN_VIEW].page(botId, before, unaborted(signal))
  }

  @Remote
  image(
    botId: string,
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<MainTimelineImageData> {
    return this[MAIN_VIEW].image(botId, sessionId, attachmentId, unaborted(signal))
  }
}

export const BOT_SKILLS_REMOTE = "botSkills" satisfies RemoteNamespace

const SKILLS = Symbol("botSkillPanel")

export class BotSkillsRemoteService extends TypertRemoteService implements BotSkillsApi {
  [SKILLS]: SkillPanel

  constructor(ctx: Context, panel: SkillPanel) {
    super(ctx, BOT_SKILLS_REMOTE)
    this[SKILLS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotSkillsView> {
    const panel = this[SKILLS]
    panel.view(botId)
    const unfollow = panel.follow(botId)
    try {
      yield* watchStream(
        () => panel.view(botId),
        (listener) =>
          panel.subscribe((changed) => {
            if (changed === botId) listener()
          }),
        signal,
      )
    } finally {
      unfollow()
    }
  }

  @Remote
  async history(botId: string, name: string): Promise<BotSkillHistory> {
    return this[SKILLS].history(botId, name)
  }

  @Remote
  async version(botId: string, name: string, versionId: string): Promise<SkillVersion> {
    return this[SKILLS].version(botId, name, versionId)
  }

  @Remote
  restoreVersion(botId: string, name: string, versionId: string): Promise<BotSkillHistory> {
    return this[SKILLS].restoreVersion(botId, name, versionId)
  }

  @Remote
  restoreArchived(botId: string, name: string): Promise<BotSkillHistory> {
    return this[SKILLS].restoreArchived(botId, name)
  }

  @Remote
  setReview(botId: string, enabled: boolean): Promise<BotSkillsView> {
    return this[SKILLS].setReview(botId, enabled)
  }

  @Remote
  setCurator(botId: string, enabled: boolean): Promise<BotSkillsView> {
    return this[SKILLS].setCurator(botId, enabled)
  }

  @Remote
  setKeep(botId: string, name: string, keep: boolean): Promise<BotSkillsView> {
    return this[SKILLS].setKeep(botId, name, keep)
  }
}

export const BOT_SETTINGS_REMOTE = "botSettings" satisfies RemoteNamespace

const SETTINGS = Symbol("botSettingsPanel")

export class BotSettingsRemoteService extends TypertRemoteService implements BotSettingsApi {
  [SETTINGS]: SettingsPanel

  constructor(ctx: Context, panel: SettingsPanel) {
    super(ctx, BOT_SETTINGS_REMOTE)
    this[SETTINGS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotSettingsHistoryView> {
    const panel = this[SETTINGS]
    panel.view(botId)
    const unfollow = panel.follow(botId)
    try {
      yield* watchStream(
        () => panel.view(botId),
        (listener) =>
          panel.subscribe((changed) => {
            if (changed === botId) listener()
          }),
        signal,
      )
    } finally {
      unfollow()
    }
  }

  @Remote
  revert(botId: string, changeId: string): Promise<BotSettingRevertResult> {
    return this[SETTINGS].revert(botId, changeId)
  }
}

export const BOT_NOTES_REMOTE = "botNotes" satisfies RemoteNamespace

const NOTES = Symbol("botNotesPanel")

export class BotNotesRemoteService extends TypertRemoteService implements BotNotesApi {
  [NOTES]: NotesPanel

  constructor(ctx: Context, panel: NotesPanel) {
    super(ctx, BOT_NOTES_REMOTE)
    this[NOTES] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotNotesStatus> {
    const panel = this[NOTES]
    const botId = panel.botOf(sessionId)
    const unfollow = panel.follow(botId)
    try {
      yield* watchStream(
        () => panel.status(botId),
        (listener) =>
          panel.subscribe((changed) => {
            if (changed === botId) listener()
          }),
        signal,
      )
    } finally {
      unfollow()
    }
  }

  @Remote
  list(sessionId: string, filter?: NoteFilter, signal?: AbortSignal): Promise<NoteListing> {
    return this[NOTES].list(sessionId, filter, signal)
  }

  @Remote
  search(sessionId: string, search: NoteSearch, signal?: AbortSignal): Promise<NoteListing> {
    return this[NOTES].search(sessionId, search, signal)
  }

  @Remote
  read(sessionId: string, noteId: string, signal?: AbortSignal): Promise<NoteDocument> {
    return this[NOTES].read(sessionId, noteId, signal)
  }

  @Remote
  month(sessionId: string, month?: string, signal?: AbortSignal): Promise<NoteMonth> {
    return this[NOTES].month(sessionId, month, signal)
  }
}

export const BOT_ENVIRONMENT_REMOTE = "botEnvironment" satisfies RemoteNamespace

const ENVIRONMENT = Symbol("botEnvironmentPanel")
const ENVIRONMENT_CHANGES = Symbol("botEnvironmentChanges")

export class BotEnvironmentRemoteService extends TypertRemoteService implements BotEnvironmentApi {
  [ENVIRONMENT]: EnvironmentPanel;
  [ENVIRONMENT_CHANGES]: (listener: () => void) => () => void

  constructor(
    ctx: Context,
    panel: EnvironmentPanel,
    subscribe: (listener: () => void) => () => void,
  ) {
    super(ctx, BOT_ENVIRONMENT_REMOTE)
    this[ENVIRONMENT] = panel
    this[ENVIRONMENT_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(botId: string, signal?: AbortSignal): AsyncIterable<BotEnvironmentView> {
    const panel = this[ENVIRONMENT]
    panel.view(botId)
    void panel.refresh(botId)
    yield* watchStream(() => panel.view(botId), this[ENVIRONMENT_CHANGES], signal)
  }

  @Remote
  configure(botId: string, spec: BotEnvironmentSpec): Promise<BotEnvironmentView> {
    return this[ENVIRONMENT].configure(botId, spec)
  }
}

export const BOT_ENVIRONMENT_HOST_REMOTE = "botEnvironmentHost" satisfies RemoteNamespace

const ENVIRONMENT_HOST = Symbol("botEnvironmentHostPanel")

export class BotEnvironmentHostRemoteService
  extends TypertRemoteService
  implements BotEnvironmentHostApi
{
  [ENVIRONMENT_HOST]: EnvironmentHostPanel

  constructor(ctx: Context, panel: EnvironmentHostPanel) {
    super(ctx, BOT_ENVIRONMENT_HOST_REMOTE)
    this[ENVIRONMENT_HOST] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotEnvironmentHostState> {
    const panel = this[ENVIRONMENT_HOST]
    yield* watchStream(
      () => panel.state(),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  check(): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].check()
  }

  @Remote
  async previewCustom(credential: CustomCredential): Promise<CustomPreview> {
    return this[ENVIRONMENT_HOST].previewCustom(credential)
  }

  @Remote
  connectCustom(request: CustomConnectRequest): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].connectCustom(request)
  }

  @Remote
  forget(): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].forget()
  }

  @Remote
  refreshImage(): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].refreshImage()
  }

  @Remote
  startImage(): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].startImage()
  }

  @Remote
  cancelImage(): Promise<BotEnvironmentHostState> {
    return this[ENVIRONMENT_HOST].cancelImage()
  }
}

export const BOT_ONBOARDING_REMOTE = "botOnboarding" satisfies RemoteNamespace

const ONBOARDING = Symbol("botOnboardingPanel")

export class BotOnboardingRemoteService extends TypertRemoteService implements BotOnboardingApi {
  [ONBOARDING]: OnboardingPanel

  constructor(ctx: Context, panel: OnboardingPanel) {
    super(ctx, BOT_ONBOARDING_REMOTE)
    this[ONBOARDING] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotOnboardingView> {
    const panel = this[ONBOARDING]
    yield* watchStream(
      () => panel.view(),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  async createBot(
    input: BotCreateInput,
    channels: readonly BotWelcomeChannelSetup[],
  ): Promise<{ id: string }> {
    try {
      return await this[ONBOARDING].createBot(input, channels)
    } catch (error) {
      throw remoteModelsError(error)
    }
  }

  @Remote
  finishWelcome(): Promise<BotOnboardingView> {
    return this[ONBOARDING].finishWelcome()
  }

  @Remote
  acknowledgeReleaseNotes(version: string): Promise<BotOnboardingView> {
    return this[ONBOARDING].acknowledgeReleaseNotes(version)
  }
}

export const BOT_VAULTS_REMOTE = "botVaults" satisfies RemoteNamespace

const VAULTS = Symbol("botVaultPanel")

export class BotVaultsRemoteService extends TypertRemoteService implements BotVaultsApi {
  [VAULTS]: VaultPanel

  constructor(ctx: Context, panel: VaultPanel) {
    super(ctx, BOT_VAULTS_REMOTE)
    this[VAULTS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotVaultsSnapshot> {
    const panel = this[VAULTS]
    const caller = this.ctx.invocation?.peer.principal
    panel.snapshot(caller)
    yield* watchStream(
      () => panel.snapshot(caller),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  addAccount(request: VaultAccountRequest): Promise<VaultAccountView> {
    return this[VAULTS].addAccount(this.ctx.invocation?.peer.principal, request)
  }

  @Remote
  renameAccount(accountId: string, label: string): Promise<VaultAccountView> {
    return this[VAULTS].renameAccount(this.ctx.invocation?.peer.principal, accountId, label)
  }

  @Remote
  removeAccount(accountId: string): Promise<{ readonly removedGrants: number }> {
    return this[VAULTS].removeAccount(this.ctx.invocation?.peer.principal, accountId)
  }

  @Remote
  listItems(accountId: string, query: string): Promise<readonly VaultItemView[]> {
    return this[VAULTS].listItems(this.ctx.invocation?.peer.principal, accountId, query)
  }

  @Remote({ mode: "stream" })
  async *watchBot(botId: string, signal?: AbortSignal): AsyncIterable<BotVaultView> {
    const panel = this[VAULTS]
    const caller = this.ctx.invocation?.peer.principal
    panel.bot(caller, botId)
    void panel.refresh(botId)
    yield* watchStream(
      () => panel.bot(caller, botId),
      (listener) => panel.subscribeBot(botId, listener),
      signal,
    )
  }

  @Remote
  grant(botId: string, request: VaultGrantRequest): Promise<VaultGrantView> {
    return this[VAULTS].grant(this.ctx.invocation?.peer.principal, botId, request)
  }

  @Remote
  updateGrant(botId: string, grantId: string, change: VaultGrantChange): Promise<VaultGrantView> {
    return this[VAULTS].updateGrant(this.ctx.invocation?.peer.principal, botId, grantId, change)
  }

  @Remote
  revoke(botId: string, grantId: string): Promise<{ readonly revoked: true }> {
    return this[VAULTS].revoke(this.ctx.invocation?.peer.principal, botId, grantId)
  }

  @Remote
  acknowledgeIncident(botId: string, incidentId: string): Promise<VaultIncidentView> {
    return this[VAULTS].acknowledgeIncident(this.ctx.invocation?.peer.principal, botId, incidentId)
  }
}

export const BOT_SENDERS_REMOTE = "botSenders" satisfies RemoteNamespace

const SENDERS = Symbol("botSenders")
const SENDER_CHANGES = Symbol("botSenderChanges")

export interface SendersBackend {
  readonly panel: SenderPanel
  readonly answers: SenderAnswers
}

export class BotSendersRemoteService extends TypertRemoteService implements BotSendersApi {
  [SENDERS]: SendersBackend;
  [SENDER_CHANGES]: (listener: () => void) => () => void

  constructor(
    ctx: Context,
    backend: SendersBackend,
    subscribe: (listener: () => void) => () => void,
  ) {
    super(ctx, BOT_SENDERS_REMOTE)
    this[SENDERS] = backend
    this[SENDER_CHANGES] = subscribe
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotSendersSnapshot> {
    const { panel } = this[SENDERS]
    yield* watchStream(() => panel.snapshot(), this[SENDER_CHANGES], signal)
  }

  @Remote
  setUnknown(connectionId: string, unknown: SenderUnknown): Promise<SenderPolicyView> {
    return this[SENDERS].panel.setUnknown(
      this.ctx.invocation?.peer.principal,
      connectionId,
      unknown,
    )
  }

  @Remote
  putRules(connectionId: string, rules: readonly SenderRuleChange[]): Promise<SenderPolicyView> {
    return this[SENDERS].panel.putRules(this.ctx.invocation?.peer.principal, connectionId, rules)
  }

  @Remote
  removeRule(connectionId: string, match: SenderMatch): Promise<SenderPolicyView> {
    return this[SENDERS].panel.removeRule(this.ctx.invocation?.peer.principal, connectionId, match)
  }

  @Remote
  copy(fromConnectionId: string, toConnectionId: string): Promise<SenderPolicyView> {
    return this[SENDERS].panel.copy(
      this.ctx.invocation?.peer.principal,
      fromConnectionId,
      toConnectionId,
    )
  }

  @Remote
  recipients(
    connectorId: string,
    connectionId: string,
    signal?: AbortSignal,
  ): Promise<SenderRecipientsView> {
    return this[SENDERS].panel.recipients(
      this.ctx.invocation?.peer.principal,
      connectorId,
      connectionId,
      signal,
    )
  }

  @Remote({ mode: "stream" })
  async *watchBot(botId: string, signal?: AbortSignal): AsyncIterable<BotSenderInquiriesSnapshot> {
    const { answers } = this[SENDERS]
    yield* watchStream(
      () => ({ botId, inquiries: answers.views(botId) }),
      this[SENDER_CHANGES],
      signal,
    )
  }

  @Remote({ mode: "stream" })
  async *watchWaiting(signal?: AbortSignal): AsyncIterable<SenderWaitingSnapshot> {
    const { answers } = this[SENDERS]
    yield* watchStream(() => ({ waiting: answers.waiting() }), this[SENDER_CHANGES], signal)
  }

  @Remote
  answer(inquiryId: string, choice: SenderChoice): Promise<SenderAnswerResult> {
    return this[SENDERS].answers.fromWeb(this.ctx.invocation?.peer.principal, inquiryId, choice)
  }
}

export const BOT_GROUPS_REMOTE = "botGroups" satisfies RemoteNamespace

const GROUPS = Symbol("botGroupsPanel")

export class BotGroupsRemoteService extends TypertRemoteService implements BotGroupsApi {
  [GROUPS]: PeerPanel

  constructor(ctx: Context, panel: PeerPanel) {
    super(ctx, BOT_GROUPS_REMOTE)
    this[GROUPS] = panel
  }

  @Remote({ mode: "stream" })
  async *watch(signal?: AbortSignal): AsyncIterable<BotGroupsSnapshot> {
    const panel = this[GROUPS]
    const caller = this.ctx.invocation?.peer.principal
    panel.snapshot(caller)
    yield* watchStream(
      () => panel.snapshot(caller),
      (listener) => panel.subscribe(listener),
      signal,
    )
  }

  @Remote
  async messages(
    groupId: string,
    before: string | undefined,
    signal?: AbortSignal,
  ): Promise<BotPeerMessagePage> {
    return this[GROUPS].messages(this.ctx.invocation?.peer.principal, groupId, before, signal)
  }

  @Remote
  create(input: BotGroupInput): Promise<BotGroupView> {
    return this[GROUPS].create(this.ctx.invocation?.peer.principal, input)
  }

  @Remote
  update(groupId: string, change: BotGroupChange): Promise<BotGroupView> {
    return this[GROUPS].update(this.ctx.invocation?.peer.principal, groupId, change)
  }

  @Remote
  deleteGroup(groupId: string): Promise<BotGroupsSnapshot> {
    return this[GROUPS].deleteGroup(this.ctx.invocation?.peer.principal, groupId)
  }

  @Remote
  join(groupId: string, botId: string, join: BotGroupJoin): Promise<BotGroupView> {
    return this[GROUPS].join(this.ctx.invocation?.peer.principal, groupId, botId, join)
  }

  @Remote
  leave(botId: string): Promise<BotGroupsSnapshot> {
    return this[GROUPS].leave(this.ctx.invocation?.peer.principal, botId)
  }

  @Remote
  setRole(botId: string, role: string): Promise<BotGroupView> {
    return this[GROUPS].setRole(this.ctx.invocation?.peer.principal, botId, role)
  }

  @Remote
  setPaused(groupId: string, paused: boolean): Promise<BotGroupView> {
    return this[GROUPS].setPaused(this.ctx.invocation?.peer.principal, groupId, paused)
  }
}

export const REMOTE_SERVICES = {
  bots: BotsRemoteService,
  botFiles: BotFilesRemoteService,
  botChannels: BotChannelsRemoteService,
  botInteractions: BotInteractionsRemoteService,
  botConnectors: BotConnectorsRemoteService,
  botConnectorActions: BotConnectorActionsRemoteService,
  botConnections: BotConnectionsRemoteService,
  botConnectorStreams: BotConnectorStreamsRemoteService,
  botWeb: BotWebRemoteService,
  botManagedSessions: BotManagedSessionsRemoteService,
  botWorkspaces: BotWorkspacesRemoteService,
  botMains: BotMainsRemoteService,
  botMainView: BotMainViewRemoteService,
  botSkills: BotSkillsRemoteService,
  botSettings: BotSettingsRemoteService,
  botNotes: BotNotesRemoteService,
  botEnvironment: BotEnvironmentRemoteService,
  botEnvironmentHost: BotEnvironmentHostRemoteService,
  botOnboarding: BotOnboardingRemoteService,
  botVaults: BotVaultsRemoteService,
  botSenders: BotSendersRemoteService,
  botGroups: BotGroupsRemoteService,
} as const satisfies {
  readonly [Namespace in RemoteNamespace]: new (
    ...args: never[]
  ) => TypertRemoteService
}
