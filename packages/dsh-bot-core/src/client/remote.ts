import type { BotsApi, BotsSnapshot } from "../shared/bots"
import type { BotChannelsApi, BotChannelsSnapshot } from "../shared/channels"
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
import type { BotFilesApi } from "../shared/files-api"
import type { BotInteractionsApi, BotInteractionsSnapshot } from "../shared/interactions"
import type { BotMainsApi, BotMainsView, MainRotationSettings } from "../shared/mains"
import type { BotManagedSessionsApi, BotManagedSessionsSnapshot } from "../shared/managed-sessions"
import type { BotModelsView } from "../shared/models"
import type { BotNotesApi, BotNotesStatus } from "../shared/notes"
import type { BotOnboardingApi, BotOnboardingView } from "../shared/onboarding"
import {
  REMOTE_ENDPOINTS,
  REMOTE_JSON_TYPE,
  REMOTE_PACKAGE,
  type RemoteEndpoint,
} from "../shared/remote-contract"
import type { BotSkillsApi, BotSkillsView } from "../shared/skills"
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

/** A Host API as its mounted Remote face: every result wrapped in a `RemoteResult`. */
export type Remoted<Api> = {
  readonly [Method in keyof Api]: Api[Method] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<RemoteResult<Awaited<Result>>>
    : never
}

/** The mounted `remote.bots`; `watch` and `watchModels` stream instead of resolving once. */
export interface BotsRemote extends Remoted<Omit<BotsApi, "watch" | "watchModels">> {
  watch(): StreamHandle<BotsSnapshot>
  watchModels(id: string): StreamHandle<BotModelsView>
}

/** The mounted `remote.botFiles`; a failure carries a `BotFileWireCode`. */
export type BotFilesRemote = Remoted<BotFilesApi>

/** The mounted `remote.botChannels`; `watch` streams instead of resolving once. */
export interface BotChannelsRemote extends Remoted<Omit<BotChannelsApi, "watch">> {
  watch(botId: string): StreamHandle<BotChannelsSnapshot>
}

/** The mounted `remote.botInteractions`; `watch` streams instead of resolving once. */
export interface BotInteractionsRemote extends Remoted<Omit<BotInteractionsApi, "watch">> {
  watch(sessionId: string): StreamHandle<BotInteractionsSnapshot>
}

/** The mounted `remote.botConnectors`; `watch` streams instead of resolving once. */
export interface BotConnectorsRemote extends Remoted<Omit<BotConnectorsApi, "watch">> {
  watch(botId: string): StreamHandle<BotConnectorsSnapshot>
}

/** The mounted `remote.botConnectorActions`; both watches stream instead of resolving once. */
export interface BotConnectorActionsRemote
  extends Remoted<Omit<BotConnectorActionsApi, "watch" | "watchWaiting">> {
  watch(botId: string): StreamHandle<BotConnectorActionsSnapshot>
  watchWaiting(): StreamHandle<ConnectorWaitingSnapshot>
}

/** The mounted `remote.botConnections`; `watch` streams instead of resolving once. */
export interface BotConnectionsRemote extends Remoted<Omit<BotConnectionsApi, "watch">> {
  watch(): StreamHandle<BotConnectionsSnapshot>
}

/** The mounted `remote.botConnectorStreams`: a stream both ways. */
export interface BotConnectorStreamsRemote {
  open(
    botId: string,
    connectorId: string,
    stream: string,
  ): DuplexStreamHandle<ConnectorJson, ConnectorJson>
}

/** The mounted `remote.botWeb`; `watch` streams instead of resolving once. */
export interface BotWebRemote extends Remoted<Omit<BotWebApi, "watch">> {
  watch(): StreamHandle<BotWebView>
}

/** The mounted `remote.botWorkspaces`; `watch` streams instead of resolving once. */
export interface BotWorkspacesRemote extends Remoted<Omit<BotWorkspacesApi, "watch">> {
  watch(): StreamHandle<BotWorkspacesSnapshot>
}

/** The mounted `remote.botManagedSessions`; `watch` streams instead of resolving once. */
export interface BotManagedSessionsRemote extends Remoted<Omit<BotManagedSessionsApi, "watch">> {
  watch(): StreamHandle<BotManagedSessionsSnapshot>
}

/** The mounted `remote.botMains`; both watches stream instead of resolving once. */
export interface BotMainsRemote extends Remoted<Omit<BotMainsApi, "watch" | "watchDefaults">> {
  watchDefaults(): StreamHandle<MainRotationSettings>
  watch(botId: string): StreamHandle<BotMainsView>
}

/** The mounted `remote.botSkills`; `watch` streams instead of resolving once. */
export interface BotSkillsRemote extends Remoted<Omit<BotSkillsApi, "watch">> {
  watch(botId: string): StreamHandle<BotSkillsView>
}

/** The mounted `remote.botNotes`; `watch` streams instead of resolving once, a failure carries a `BotNoteWireCode`. */
export interface BotNotesRemote extends Remoted<Omit<BotNotesApi, "watch">> {
  watch(sessionId: string): StreamHandle<BotNotesStatus>
}

/** The mounted `remote.botEnvironment`; `watch` streams instead of resolving once. */
export interface BotEnvironmentRemote extends Remoted<Omit<BotEnvironmentApi, "watch">> {
  watch(botId: string): StreamHandle<BotEnvironmentView>
}

/** The mounted `remote.botOnboarding`; `watch` streams instead of resolving once. */
export interface BotOnboardingRemote extends Remoted<Omit<BotOnboardingApi, "watch">> {
  watch(): StreamHandle<BotOnboardingView>
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
  readonly botSkills: BotSkillsRemote
  readonly botNotes: BotNotesRemote
  readonly botEnvironment: BotEnvironmentRemote
  readonly botOnboarding: BotOnboardingRemote
}

/** The outcome of mounting the contribution: every namespace, or why none is. */
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

/** The one contribution `ctx.remote.$mount` takes for bot-core; typert registers a package once. */
export const BOT_CORE_REMOTE: RemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: REMOTE_ENDPOINTS.map(descriptor),
}
