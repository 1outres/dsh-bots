import type { BotsApi } from "./bots"
import type { BotChannelsApi } from "./channels"
import type { BotConnectionsApi } from "./connections"
import type { BotConnectorActionsApi, BotConnectorStreamsApi, BotConnectorsApi } from "./connectors"
import type { BotEnvironmentApi } from "./environment"
import type { BotEnvironmentHostApi } from "./environment-host"
import type { BotFilesApi } from "./files-api"
import type { BotHeartbeatApi } from "./heartbeat"
import type { BotInteractionsApi } from "./interactions"
import type { BotMainViewApi } from "./main-view"
import type { BotMainsApi } from "./mains"
import type { BotManagedSessionsApi } from "./managed-sessions"
import type { BotNotesApi } from "./notes"
import type { BotOnboardingApi } from "./onboarding"
import type { BotGroupsApi } from "./peers"
import type { BotSendersApi } from "./senders"
import type { BotSettingsApi } from "./settings"
import type { BotSkillsApi } from "./skills"
import type { BotVaultsApi } from "./vaults"
import type { BotWebApi } from "./web"
import type { BotWorkspacesApi } from "./workspaces"

export const REMOTE_PACKAGE = "@1outres/dsh-bot-core"

export const REMOTE_JSON_TYPE = `${REMOTE_PACKAGE}/json`

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
  readonly botHeartbeat: BotHeartbeatApi
  readonly botMainView: BotMainViewApi
  readonly botSkills: BotSkillsApi
  readonly botSettings: BotSettingsApi
  readonly botNotes: BotNotesApi
  readonly botEnvironment: BotEnvironmentApi
  readonly botEnvironmentHost: BotEnvironmentHostApi
  readonly botOnboarding: BotOnboardingApi
  readonly botVaults: BotVaultsApi
  readonly botSenders: BotSendersApi
  readonly botGroups: BotGroupsApi
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
  "botHeartbeat",
  "botMainView",
  "botSkills",
  "botSettings",
  "botNotes",
  "botEnvironment",
  "botEnvironmentHost",
  "botOnboarding",
  "botVaults",
  "botSenders",
  "botGroups",
] as const satisfies readonly RemoteNamespace[]

export const REMOTE_CONTRACT_CODES = [
  "gateway/arguments-invalid",
  "gateway/input-invalid",
  "gateway/signature-invalid",
] as const

export type RemoteContractCode = (typeof REMOTE_CONTRACT_CODES)[number]

export interface RemoteParameter {
  readonly name: string
  readonly optional?: true
}

export interface RemoteMethodContract {
  readonly parameters: readonly RemoteParameter[]
  readonly stream?: true
  readonly cancellable?: true
  readonly uplink?: true
}

export type RemoteMethodContracts<Api> = { readonly [Method in keyof Api]: RemoteMethodContract }

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
    watchShared: { parameters: [], stream: true, cancellable: true },
    configureShared: { parameters: [{ name: "channelId" }, { name: "change" }] },
    defaults: { parameters: [] },
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
  botHeartbeat: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    configure: { parameters: [{ name: "botId" }, { name: "settings" }] },
  },
  botMainView: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    page: { parameters: [{ name: "botId" }, { name: "before" }], cancellable: true },
    image: {
      parameters: [{ name: "botId" }, { name: "sessionId" }, { name: "attachmentId" }],
      cancellable: true,
    },
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
  botSettings: {
    watch: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    revert: { parameters: [{ name: "botId" }, { name: "changeId" }] },
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
    previewCustom: { parameters: [{ name: "credential" }] },
    connectCustom: { parameters: [{ name: "request" }] },
    setupIdentity: { parameters: [] },
    removeSetupIdentity: { parameters: [{ name: "scope" }] },
    scanHostKey: { parameters: [{ name: "target" }], cancellable: true },
    inspectSetup: { parameters: [{ name: "request" }], cancellable: true },
    startSetup: { parameters: [{ name: "request" }] },
    cancelSetup: { parameters: [{ name: "jobId" }] },
    dismissSetup: { parameters: [{ name: "jobId" }] },
    investigateSetup: { parameters: [{ name: "jobId" }] },
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
  botSenders: {
    watch: { parameters: [], stream: true, cancellable: true },
    setUnknown: { parameters: [{ name: "connectionId" }, { name: "unknown" }] },
    putRules: { parameters: [{ name: "connectionId" }, { name: "rules" }] },
    removeRule: { parameters: [{ name: "connectionId" }, { name: "match" }] },
    copy: { parameters: [{ name: "fromConnectionId" }, { name: "toConnectionId" }] },
    recipients: {
      parameters: [{ name: "connectorId" }, { name: "connectionId" }],
      cancellable: true,
    },
    watchBot: { parameters: [{ name: "botId" }], stream: true, cancellable: true },
    watchWaiting: { parameters: [], stream: true, cancellable: true },
    answer: { parameters: [{ name: "inquiryId" }, { name: "choice" }] },
  },
  botGroups: {
    watch: { parameters: [], stream: true, cancellable: true },
    messages: {
      parameters: [{ name: "groupId" }, { name: "before", optional: true }],
      cancellable: true,
    },
    create: { parameters: [{ name: "input" }] },
    update: { parameters: [{ name: "groupId" }, { name: "change" }] },
    deleteGroup: { parameters: [{ name: "groupId" }] },
    join: { parameters: [{ name: "groupId" }, { name: "botId" }, { name: "join" }] },
    leave: { parameters: [{ name: "botId" }] },
    setRole: { parameters: [{ name: "botId" }, { name: "role" }] },
    setPaused: { parameters: [{ name: "groupId" }, { name: "paused" }] },
  },
}

export interface RemoteEndpoint {
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
