import type { BotsApi, BotsSnapshot } from "../shared/bots"
import type {
  BotChannelSharedSnapshot,
  BotChannelsApi,
  BotChannelsSnapshot,
} from "../shared/channels"
import type { BotConnectionsApi, BotConnectionsSnapshot } from "../shared/connections"
import type {
  BotConnectorActionsApi,
  BotConnectorActionsSnapshot,
  BotConnectorsApi,
  BotConnectorsSnapshot,
  ConnectorJson,
  ConnectorWaitingSnapshot,
} from "../shared/connectors"
import type { BotEnvironmentApi, BotEnvironmentView } from "../shared/environment"
import type { BotEnvironmentHostApi, BotEnvironmentHostState } from "../shared/environment-host"
import type { BotFilesApi } from "../shared/files-api"
import type { BotHeartbeatApi, BotHeartbeatView } from "../shared/heartbeat"
import type { BotInteractionsApi, BotInteractionsSnapshot } from "../shared/interactions"
import type { BotMainInputApi, MainInputState } from "../shared/main-input"
import type { BotMainViewApi, MainTimelineFrame } from "../shared/main-view"
import type { BotMainsApi, BotMainsView, MainRotationSettings } from "../shared/mains"
import type { BotManagedSessionsApi, BotManagedSessionsSnapshot } from "../shared/managed-sessions"
import type { BotModelsView } from "../shared/models"
import type { BotNotesApi, BotNotesStatus } from "../shared/notes"
import type { BotOnboardingApi, BotOnboardingView } from "../shared/onboarding"
import type { BotGroupsApi, BotGroupsSnapshot } from "../shared/peers"
import {
  REMOTE_ENDPOINTS,
  REMOTE_JSON_TYPE,
  REMOTE_PACKAGE,
  type RemoteEndpoint,
} from "../shared/remote-contract"
import type {
  BotSenderInquiriesSnapshot,
  BotSendersApi,
  BotSendersSnapshot,
  SenderWaitingSnapshot,
} from "../shared/senders"
import type { BotSettingsApi, BotSettingsHistoryView } from "../shared/settings"
import type { BotSkillsApi, BotSkillsView } from "../shared/skills"
import type { BotSpacesApi, BotSpacesView } from "../shared/spaces"
import type { BotVaultsApi, BotVaultsSnapshot, BotVaultView } from "../shared/vaults"
import type { BotWebApi, BotWebView } from "../shared/web"
import type { BotWorkspacesApi, BotWorkspacesSnapshot } from "../shared/workspaces"
import type {
  DuplexStreamHandle,
  RemoteCodec,
  RemoteContribution,
  RemoteInvocationDescriptor,
  RemoteResult,
  StreamHandle,
} from "./dsh/remote"

export type { BotCoreApi, RemoteNamespace } from "../shared/remote-contract"

export type Remoted<Api> = {
  readonly [Method in keyof Api]: Api[Method] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<RemoteResult<Awaited<Result>>>
    : never
}

export interface BotsRemote extends Remoted<Omit<BotsApi, "watch" | "watchModels">> {
  watch(): StreamHandle<BotsSnapshot>
  watchModels(id: string): StreamHandle<BotModelsView>
}

export type BotFilesRemote = Remoted<BotFilesApi>

export interface BotChannelsRemote extends Remoted<Omit<BotChannelsApi, "watch" | "watchShared">> {
  watch(botId: string): StreamHandle<BotChannelsSnapshot>
  watchShared(): StreamHandle<BotChannelSharedSnapshot>
}

export interface BotInteractionsRemote extends Remoted<Omit<BotInteractionsApi, "watch">> {
  watch(sessionId: string): StreamHandle<BotInteractionsSnapshot>
}

export interface BotConnectorsRemote extends Remoted<Omit<BotConnectorsApi, "watch">> {
  watch(botId: string): StreamHandle<BotConnectorsSnapshot>
}

export interface BotConnectorActionsRemote
  extends Remoted<Omit<BotConnectorActionsApi, "watch" | "watchWaiting">> {
  watch(botId: string): StreamHandle<BotConnectorActionsSnapshot>
  watchWaiting(): StreamHandle<ConnectorWaitingSnapshot>
}

export interface BotConnectionsRemote extends Remoted<Omit<BotConnectionsApi, "watch">> {
  watch(): StreamHandle<BotConnectionsSnapshot>
}

export interface BotConnectorStreamsRemote {
  open(
    botId: string,
    connectorId: string,
    stream: string,
  ): DuplexStreamHandle<ConnectorJson, ConnectorJson>
}

export interface BotWebRemote extends Remoted<Omit<BotWebApi, "watch">> {
  watch(): StreamHandle<BotWebView>
}

export interface BotWorkspacesRemote extends Remoted<Omit<BotWorkspacesApi, "watch">> {
  watch(): StreamHandle<BotWorkspacesSnapshot>
}

export interface BotManagedSessionsRemote extends Remoted<Omit<BotManagedSessionsApi, "watch">> {
  watch(): StreamHandle<BotManagedSessionsSnapshot>
}

export interface BotMainsRemote extends Remoted<Omit<BotMainsApi, "watch" | "watchDefaults">> {
  watchDefaults(): StreamHandle<MainRotationSettings>
  watch(botId: string): StreamHandle<BotMainsView>
}

export interface BotHeartbeatRemote extends Remoted<Omit<BotHeartbeatApi, "watch">> {
  watch(botId: string): StreamHandle<BotHeartbeatView>
}

export interface BotMainViewRemote extends Remoted<Omit<BotMainViewApi, "watch">> {
  watch(botId: string): StreamHandle<MainTimelineFrame>
}

export interface BotMainInputRemote extends Remoted<Omit<BotMainInputApi, "watch">> {
  watch(botId: string): StreamHandle<MainInputState>
}

export interface BotSkillsRemote extends Remoted<Omit<BotSkillsApi, "watch">> {
  watch(botId: string): StreamHandle<BotSkillsView>
}

export interface BotSettingsRemote extends Remoted<Omit<BotSettingsApi, "watch">> {
  watch(botId: string): StreamHandle<BotSettingsHistoryView>
}

export interface BotNotesRemote extends Remoted<Omit<BotNotesApi, "watch">> {
  watch(sessionId: string): StreamHandle<BotNotesStatus>
}

export interface BotEnvironmentRemote extends Remoted<Omit<BotEnvironmentApi, "watch">> {
  watch(botId: string): StreamHandle<BotEnvironmentView>
}

export interface BotEnvironmentHostRemote extends Remoted<Omit<BotEnvironmentHostApi, "watch">> {
  watch(): StreamHandle<BotEnvironmentHostState>
}

export interface BotOnboardingRemote extends Remoted<Omit<BotOnboardingApi, "watch">> {
  watch(): StreamHandle<BotOnboardingView>
}

export interface BotVaultsRemote extends Remoted<Omit<BotVaultsApi, "watch" | "watchBot">> {
  watch(): StreamHandle<BotVaultsSnapshot>
  watchBot(botId: string): StreamHandle<BotVaultView>
}

export interface BotSendersRemote
  extends Remoted<Omit<BotSendersApi, "watch" | "watchBot" | "watchWaiting">> {
  watch(): StreamHandle<BotSendersSnapshot>
  watchBot(botId: string): StreamHandle<BotSenderInquiriesSnapshot>
  watchWaiting(): StreamHandle<SenderWaitingSnapshot>
}

export interface BotGroupsRemote extends Remoted<Omit<BotGroupsApi, "watch">> {
  watch(): StreamHandle<BotGroupsSnapshot>
}

export interface BotSpacesRemote extends Remoted<Omit<BotSpacesApi, "watch">> {
  watch(): StreamHandle<BotSpacesView>
}

export interface BotCoreRemote {
  readonly bots: BotsRemote
  readonly botFiles: BotFilesRemote
  readonly botChannels: BotChannelsRemote
  readonly botInteractions: BotInteractionsRemote
  readonly botConnectors: BotConnectorsRemote
  readonly botConnectorActions: BotConnectorActionsRemote
  readonly botConnections: BotConnectionsRemote
  readonly botConnectorStreams: BotConnectorStreamsRemote
  readonly botWeb: BotWebRemote
  readonly botManagedSessions: BotManagedSessionsRemote
  readonly botWorkspaces: BotWorkspacesRemote
  readonly botMains: BotMainsRemote
  readonly botHeartbeat: BotHeartbeatRemote
  readonly botMainView: BotMainViewRemote
  readonly botMainInput: BotMainInputRemote
  readonly botSkills: BotSkillsRemote
  readonly botSettings: BotSettingsRemote
  readonly botNotes: BotNotesRemote
  readonly botEnvironment: BotEnvironmentRemote
  readonly botEnvironmentHost: BotEnvironmentHostRemote
  readonly botOnboarding: BotOnboardingRemote
  readonly botVaults: BotVaultsRemote
  readonly botSenders: BotSendersRemote
  readonly botGroups: BotGroupsRemote
  readonly botSpaces: BotSpacesRemote
}

export type RemoteMount =
  | { readonly status: "mounted"; readonly remote: BotCoreRemote }
  | { readonly status: "failed"; readonly error: string }

const codec: RemoteCodec = {
  mode: "strict",
  typeSymbol: REMOTE_JSON_TYPE,
  create: () => ({ parse: (value: unknown) => value }),
}

function descriptor({
  id,
  namespace,
  method,
  contract,
}: RemoteEndpoint): RemoteInvocationDescriptor {
  return {
    id,
    service: namespace,
    namespace,
    method,
    ...(contract.stream ? { mode: "stream" as const } : {}),
    invocation: { kind: "direct" },
    parameters: contract.parameters.map(({ name }) => ({
      name,
      wire: name,
      source: "json",
      codec,
    })),
    ...(contract.cancellable ? { cancellation: { parameter: "signal" as const } } : {}),
    ...(contract.uplink ? { uplink: { codec } } : {}),
    result: codec,
  }
}

export const BOT_CORE_REMOTE: RemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: REMOTE_ENDPOINTS.map(descriptor),
}
