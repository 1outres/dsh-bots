import type { BotsApi } from "./bots"
import type { BotChannelsApi } from "./channels"
import type { BotConnectionsApi } from "./connections"
import type { BotConnectorActionsApi, BotConnectorStreamsApi, BotConnectorsApi } from "./connectors"
import type { BotEnvironmentApi } from "./environment"
import type { BotEnvironmentHostApi } from "./environment-host"
import type { BotFilesApi } from "./files-api"
import type { BotInteractionsApi } from "./interactions"
import type { BotMainsApi } from "./mains"
import type { BotManagedSessionsApi } from "./managed-sessions"
import type { BotNotesApi } from "./notes"
import type { BotOnboardingApi } from "./onboarding"
import type { BotSkillsApi } from "./skills"
import type { BotVaultsApi } from "./vaults"
import type { BotWebApi } from "./web"
import type { BotWorkspacesApi } from "./workspaces"

/** The npm package that owns bot-core's Remote; both faces register under it. */
export const REMOTE_PACKAGE = "@1outres/dsh-bot-core"

/** Type symbol of the JSON codec every argument and result of bot-core's Remote uses. */
export const REMOTE_JSON_TYPE = `${REMOTE_PACKAGE}/json`

/** Every Host API of bot-core's Remote, keyed by its wire namespace (`remote.<namespace>`). */
export interface BotCoreApi {
  readonly bots: BotsApi
  readonly botFiles: BotFilesApi
  readonly botChannels: BotChannelsApi
  readonly botInteractions: BotInteractionsApi
  readonly botConnectors: BotConnectorsApi
  readonly botConnectorActions: BotConnectorActionsApi
  readonly botConnections: BotConnectionsApi
  readonly botConnectorStreams: BotConnectorStreamsApi
  readonly botWeb: BotWebApi
  readonly botManagedSessions: BotManagedSessionsApi
  readonly botWorkspaces: BotWorkspacesApi
  readonly botMains: BotMainsApi
  readonly botSkills: BotSkillsApi
  readonly botNotes: BotNotesApi
  readonly botEnvironment: BotEnvironmentApi
  readonly botEnvironmentHost: BotEnvironmentHostApi
  readonly botOnboarding: BotOnboardingApi
  readonly botVaults: BotVaultsApi
}

export type RemoteNamespace = keyof BotCoreApi

export const REMOTE_NAMESPACES = [
  "bots",
  "botFiles",
  "botChannels",
  "botInteractions",
  "botConnectors",
  "botConnectorActions",
  "botConnections",
  "botConnectorStreams",
  "botWeb",
  "botManagedSessions",
  "botWorkspaces",
  "botMains",
  "botSkills",
  "botNotes",
  "botEnvironment",
  "botEnvironmentHost",
  "botOnboarding",
  "botVaults",
] as const satisfies readonly RemoteNamespace[]

/** Gateway refusals of a call whose shape is not the Host's declared contract: the two faces disagree. */
export const REMOTE_CONTRACT_CODES = [
  "gateway/arguments-invalid",
  "gateway/input-invalid",
  "gateway/signature-invalid",
] as const

export type RemoteContractCode = (typeof REMOTE_CONTRACT_CODES)[number]

/** One wire argument: its `args` field and whether the caller may omit it. */
export interface RemoteParameter {
  readonly name: string
  readonly optional?: true
}

export interface RemoteMethodContract {
  /** The wire arguments, in the Host method's parameter order, before the trailing `signal`. */
  readonly parameters: readonly RemoteParameter[]
  readonly stream?: true
  /** The Host method takes a trailing `signal`. */
  readonly cancellable?: true
  /** The Client sends JSON items back on the stream (`RemoteInvocation.uplink()`). */
  readonly uplink?: true
}

export type RemoteMethodContracts<Api> = { readonly [Method in keyof Api]: RemoteMethodContract }

/**
 * The wire contract of every Remote method, declared rather than read from the
 * Host methods' parameter identifiers, which a bundler may rename.
 */
export const REMOTE_METHODS: {
  readonly [Namespace in RemoteNamespace]: RemoteMethodContracts<BotCoreApi[Namespace]>
} = {
  bots: {
    watch: { parameters: [], stream: true, cancellable: true },
    create: { parameters: [{ name: "input" }] },
    creationOptions: { parameters: [] },
    retryCreate: { parameters: [{ name: "id" }] },
    discardCreate: { parameters: [{ name: "id" }] },
    update: { parameters: [{ name: "id" }, { name: "input" }] },
    removeBot: { parameters: [{ name: "id" }] },
    retryRemove: { parameters: [{ name: "id" }] },
    dismissRemove: { parameters: [{ name: "id" }] },
    createSession: { parameters: [{ name: "botId" }] },
    models: { parameters: [{ name: "id" }] },
    watchModels: { parameters: [{ name: "id" }], stream: true, cancellable: true },
    configureModels: { parameters: [{ name: "id" }, { name: "change" }] },
    modelCatalog: { parameters: [] },
  },
  botFiles: {
    stat: { parameters: [{ name: "sessionId" }, { name: "path" }], cancellable: true },
    read: {
      parameters: [{ name: "sessionId" }, { name: "path" }, { name: "range", optional: true }],
      cancellable: true,
    },
    readBytes: {
      parameters: [{ name: "sessionId" }, { name: "path" }, { name: "options", optional: true }],
      cancellable: true,
    },
    list: { parameters: [{ name: "sessionId" }, { name: "path" }], cancellable: true },
    search: { parameters: [{ name: "sessionId" }, { name: "request" }], cancellable: true },
  },
  botChannels: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    configure: { parameters: [{ name: "botId" }, { name: "channelId" }, { name: "change" }] },
    options: {
      parameters: [{ name: "channelId" }, { name: "settings" }, { name: "source" }],
      cancellable: true,
    },
    inspect: { parameters: [{ name: "channelId" }, { name: "settings" }], cancellable: true },
    check: { parameters: [{ name: "channelId" }, { name: "settings" }], cancellable: true },
  },
  botInteractions: {
    watch: { parameters: [{ name: "sessionId" }], stream: true, cancellable: true },
    answer: {
      parameters: [{ name: "sessionId" }, { name: "interactionId" }, { name: "answer" }],
    },
    hold: { parameters: [{ name: "sessionId" }, { name: "interactionId" }] },
  },
  botConnectors: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    configure: { parameters: [{ name: "botId" }, { name: "connectorId" }, { name: "change" }] },
    setPermission: { parameters: [{ name: "botId" }, { name: "change" }] },
    retry: { parameters: [{ name: "botId" }, { name: "connectorId" }] },
  },
  botConnectorActions: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    watchWaiting: { parameters: [], stream: true, cancellable: true },
    decide: { parameters: [{ name: "botId" }, { name: "actionId" }, { name: "decision" }] },
  },
  botConnections: {
    watch: { parameters: [], stream: true, cancellable: true },
    configureClient: { parameters: [{ name: "provider" }, { name: "change" }] },
    authorize: { parameters: [{ name: "request" }] },
    rename: { parameters: [{ name: "connectionId" }, { name: "label" }] },
    assign: { parameters: [{ name: "botId" }, { name: "connectionId" }, { name: "assigned" }] },
    disconnect: { parameters: [{ name: "connectionId" }] },
  },
  botConnectorStreams: {
    open: {
      parameters: [{ name: "botId" }, { name: "connectorId" }, { name: "stream" }],
      stream: true,
      cancellable: true,
      uplink: true,
    },
  },
  botWeb: {
    view: { parameters: [] },
    watch: { parameters: [], stream: true, cancellable: true },
    setEnabled: { parameters: [{ name: "capability" }, { name: "enabled" }] },
    setSecret: { parameters: [{ name: "key" }, { name: "change" }] },
    test: { parameters: [] },
  },
  botManagedSessions: {
    watch: { parameters: [], stream: true, cancellable: true },
    entrust: { parameters: [{ name: "botId" }, { name: "sessionId" }] },
    release: { parameters: [{ name: "botId" }, { name: "sessionId" }] },
    setAnswerer: {
      parameters: [{ name: "botId" }, { name: "sessionId" }, { name: "answerer" }],
    },
  },
  botWorkspaces: {
    watch: { parameters: [], stream: true, cancellable: true },
    options: { parameters: [] },
    grant: { parameters: [{ name: "botId" }, { name: "workspaceId" }, { name: "settings" }] },
    configure: { parameters: [{ name: "botId" }, { name: "workspaceId" }, { name: "change" }] },
    revoke: { parameters: [{ name: "botId" }, { name: "workspaceId" }] },
  },
  botMains: {
    watchDefaults: { parameters: [], stream: true, cancellable: true },
    setDefaults: { parameters: [{ name: "settings" }] },
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    configure: { parameters: [{ name: "botId" }, { name: "override" }] },
    startNew: { parameters: [{ name: "botId" }] },
  },
  botSkills: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    history: { parameters: [{ name: "botId" }, { name: "name" }] },
    version: { parameters: [{ name: "botId" }, { name: "name" }, { name: "versionId" }] },
    restoreVersion: { parameters: [{ name: "botId" }, { name: "name" }, { name: "versionId" }] },
    restoreArchived: { parameters: [{ name: "botId" }, { name: "name" }] },
    setReview: { parameters: [{ name: "botId" }, { name: "enabled" }] },
    setCurator: { parameters: [{ name: "botId" }, { name: "enabled" }] },
    setKeep: { parameters: [{ name: "botId" }, { name: "name" }, { name: "keep" }] },
  },
  botNotes: {
    watch: { parameters: [{ name: "sessionId" }], stream: true, cancellable: true },
    list: {
      parameters: [{ name: "sessionId" }, { name: "filter", optional: true }],
      cancellable: true,
    },
    search: { parameters: [{ name: "sessionId" }, { name: "search" }], cancellable: true },
    read: { parameters: [{ name: "sessionId" }, { name: "noteId" }], cancellable: true },
    month: {
      parameters: [{ name: "sessionId" }, { name: "month", optional: true }],
      cancellable: true,
    },
  },
  botEnvironment: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    configure: { parameters: [{ name: "botId" }, { name: "spec" }] },
  },
  botEnvironmentHost: {
    watch: { parameters: [], stream: true, cancellable: true },
    check: { parameters: [] },
    previewToken: { parameters: [{ name: "token" }] },
    pair: { parameters: [{ name: "pairing" }] },
    useLocal: { parameters: [{ name: "project" }] },
    setProject: { parameters: [{ name: "project" }] },
    forget: { parameters: [] },
    refreshImage: { parameters: [] },
    startImage: { parameters: [] },
    cancelImage: { parameters: [] },
  },
  botOnboarding: {
    watch: { parameters: [], stream: true, cancellable: true },
    createBot: { parameters: [{ name: "input" }, { name: "channels" }] },
    finishWelcome: { parameters: [] },
    acknowledgeReleaseNotes: { parameters: [{ name: "version" }] },
  },
  botVaults: {
    watch: { parameters: [], stream: true, cancellable: true },
    addAccount: { parameters: [{ name: "request" }] },
    renameAccount: { parameters: [{ name: "accountId" }, { name: "label" }] },
    removeAccount: { parameters: [{ name: "accountId" }] },
    listItems: { parameters: [{ name: "accountId" }, { name: "query" }] },
    watchBot: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    grant: { parameters: [{ name: "botId" }, { name: "request" }] },
    updateGrant: { parameters: [{ name: "botId" }, { name: "grantId" }, { name: "change" }] },
    revoke: { parameters: [{ name: "botId" }, { name: "grantId" }] },
    acknowledgeIncident: { parameters: [{ name: "botId" }, { name: "incidentId" }] },
  },
}

/** One Remote method with its endpoint identity. */
export interface RemoteEndpoint {
  /** Stable across both faces: `<package>#<namespace>/<method>`. */
  readonly id: string
  readonly namespace: RemoteNamespace
  readonly method: string
  readonly contract: RemoteMethodContract
}

export const REMOTE_ENDPOINTS: readonly RemoteEndpoint[] = REMOTE_NAMESPACES.flatMap((namespace) =>
  Object.entries<RemoteMethodContract>(REMOTE_METHODS[namespace]).map(([method, contract]) => ({
    id: `${REMOTE_PACKAGE}#${namespace}/${method}`,
    namespace,
    method,
    contract,
  })),
)
