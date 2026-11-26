import type { Context } from "@deepseek-ai/cordis"
import type { BotChannel } from "./channel-contract"
import type { BotConnectionProvider, BotConnector } from "./connector-contract"
import type { MainPreparation } from "./mains-contract"
import type { BotSettingsArea } from "./settings-contract"
import type { BotView, EnvironmentPhase } from "./shared/bots"
import type { BotChannelField } from "./shared/channels"
import type {
  BotConnectorChange,
  BotConnectorView,
  ConnectorAction,
  ConnectorActionChange,
  ConnectorPermissionChange,
  ConnectorToolPermission,
} from "./shared/connectors"
import type { BotEnvironmentCapacity, BotEnvironmentSpec } from "./shared/environment"
import type {
  EnvironmentHostPairing,
  EnvironmentHostView,
  TrustTokenPreview,
} from "./shared/environment-host"
import type { BotEnvironmentImageHost } from "./shared/environment-image"
import type {
  BotModelCatalog,
  BotModelChoice,
  BotModelSelection,
  BotModelsChange,
  BotModelsView,
} from "./shared/models"
import type {
  BotOverlay,
  BotPresetPreview,
  BotPresetState,
  BotTemplate,
  PluginRow,
} from "./shared/preset"
import type { BotWebStatus } from "./shared/web"
import type { BotVaultProvider, VaultKit } from "./vault-contract"
import type { BotWebBackend } from "./web-contract"

export type * from "./channel-contract"
export * from "./connector-contract"
export type * from "./connector-panel-contract"
export type * from "./mains-contract"
export type * from "./settings-contract"
export * from "./vault-bytes"
export * from "./vault-contract"
export type * from "./web-contract"

export const BOT_SERVICE = "bot"

export interface BotEnvironmentBot {
  readonly id: string
  readonly name: string
}

export interface BotEnvironmentTarget extends BotEnvironmentBot {
  readonly spec: BotEnvironmentSpec
}

export type * from "./shared/environment"
export type * from "./shared/environment-image"

export interface EnsureOptions {
  readonly signal?: AbortSignal
  readonly progress?: (phase: EnvironmentPhase) => void
}

export interface BotEnvironment {
  readonly id: string
  readonly isolate: readonly string[]
  readonly workspace: string
  ensure(target: BotEnvironmentTarget, options?: EnsureOptions): Promise<void>
  capacity(botId: string, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  inspect(botId: string, signal?: AbortSignal): Promise<BotEnvironmentSpec | undefined>
  remove(botId: string): Promise<void>
  rows(bot: BotEnvironmentBot): readonly PluginRow[]
  onChange?(listener: (botId: string) => void): () => void
  readonly host?: BotEnvironmentHost
}

export interface BotEnvironmentHost {
  view(): EnvironmentHostView
  subscribe(listener: () => void): () => void
  check(signal?: AbortSignal): Promise<EnvironmentHostView>
  previewToken(token: string): TrustTokenPreview
  pair(pairing: EnvironmentHostPairing, signal?: AbortSignal): Promise<EnvironmentHostView>
  useLocal(project: string): Promise<EnvironmentHostView>
  setProject(project: string): Promise<EnvironmentHostView>
  forget(): Promise<EnvironmentHostView>
  readonly image?: BotEnvironmentImageHost
}

export interface BotEnvironmentInfo {
  readonly id: string
  readonly isolate: readonly string[]
  readonly workspace: string
}

export type BotSessionModelRequest =
  | { readonly role: "main" }
  | { readonly role: "delegate"; readonly choice: BotModelChoice }

export interface BotSessionOptions {
  readonly title?: string
  readonly model?: BotSessionModelRequest
}

export interface BotPresetChange {
  readonly template?: string
  readonly overlay?: BotOverlay
}

export interface Bot {
  bots(): readonly BotView[]
  botIds(): readonly string[]
  registerChannel<F extends readonly BotChannelField[]>(channel: BotChannel<F>): () => void
  channels(): readonly BotChannel[]

  registerConnector<A>(connector: BotConnector<A>): () => void
  connectors(): readonly BotConnector<unknown>[]
  registerConnectionProvider(provider: BotConnectionProvider): () => void
  connectionProviders(): readonly BotConnectionProvider[]
  connectorStates(botId: string): readonly BotConnectorView[]
  configureConnector(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView>
  retryConnector(botId: string, connectorId: string): BotConnectorView
  onConnectorStateChange(listener: (botId: string) => void): () => void
  connectorPermissions(botId: string): readonly ConnectorToolPermission[]
  setConnectorPermission(
    botId: string,
    change: ConnectorPermissionChange,
  ): Promise<readonly ConnectorToolPermission[]>
  connectorActions(botId: string): readonly ConnectorAction[]
  onConnectorActionChange(listener: (change: ConnectorActionChange) => void): () => void

  registerTemplate(template: BotTemplate): () => void
  templates(): readonly BotTemplate[]
  presetOf(botId: string): BotPresetState | undefined
  onPresetChange(listener: (botId: string) => void): () => void
  previewPreset(botId: string, change: BotPresetChange): BotPresetPreview
  configurePreset(botId: string, change: BotPresetChange): Promise<BotPresetState>
  createSession(botId: string, options?: BotSessionOptions): Promise<{ sessionId: string }>

  models(botId: string): BotModelsView
  configureModels(botId: string, change: BotModelsChange): Promise<BotModelsView>
  modelCatalog(): Promise<BotModelCatalog>
  resolveModel(choice: BotModelChoice): Promise<BotModelSelection>
  onModelsChange(listener: (botId: string) => void): () => void

  registerEnvironment(environment: BotEnvironment): () => void
  registerMainPreparation(preparation: MainPreparation): () => void

  environment(): BotEnvironmentInfo | undefined

  registerWebBackend(backend: BotWebBackend): () => void
  webBackends(): readonly BotWebBackend[]
  webStatus(): BotWebStatus
  onWebChange(listener: () => void): () => void

  registerVaultProvider(provider: BotVaultProvider): () => void
  vaultProviders(): readonly BotVaultProvider[]
  vaultKit(): VaultKit

  registerSettingsArea(area: BotSettingsArea): () => void
  settingsAreas(): readonly BotSettingsArea[]
}

export function watchBotPresets(ctx: Context, listener: (botId: string) => void): void {
  ctx.effect(() => botOf(ctx).onPresetChange(listener), "bot: preset changes")
}

export function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT_SERVICE) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT_SERVICE}" service is not available; inject it`)
  return bot
}
