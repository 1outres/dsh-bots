import type { InferArgs, ParameterSchemaSpec } from "@deepseek-ai/dsh-tools"
import type { ConnectionAccount, ConnectorConnectionInfo } from "./shared/connections"
import type {
  BotCreationOption,
  ConnectorEventKind,
  ConnectorJson,
  ConnectorPanelIcon,
  ConnectorPanelPresentation,
  ConnectorPermission,
  ConnectorPreview,
  ConnectorSessions,
  ConnectorSettingField,
  ConnectorSettingValues,
  ConnectorStatus,
  ConnectorText,
} from "./shared/connectors"
import type { BotEnvironmentMinimum } from "./shared/environment"
import type { BotVaultAccess } from "./vault-contract"

export type * from "./shared/connections"
export type * from "./shared/connectors"

export interface BotConnector<A = undefined> {
  readonly id: string
  readonly name: string
  readonly description?: ConnectorText
  readonly sessions: ConnectorSessions
  readonly settings?: readonly ConnectorSettingField[]
  readonly minimumSpec?: BotEnvironmentMinimum
  readonly preparation?: BotConnectorPreparation
  readonly requires?: readonly string[]
  readonly creationOption?: BotCreationOption
  readonly attachment?: BotConnectorAttachmentSource<A>
  readonly connections?: BotConnectorConnections
  readonly events?: BotConnectorEvents
  readonly tools: readonly BotConnectorToolDefinition<A>[]
  readonly panel?: BotConnectorPanel
  readonly status?: BotConnectorStatusSource
}

export interface BotConnectorPanel {
  readonly title: ConnectorText
  readonly icon: ConnectorPanelIcon
  readonly presentation: ConnectorPanelPresentation
  readonly streams: readonly BotConnectorStream[]
}

export interface BotConnectorStreamDefinition<Up> {
  readonly name: string
  parse(item: unknown): Up
  open(stream: BotConnectorStreamRun<Up>): AsyncIterable<ConnectorJson>
}

export type BotConnectorStream = BotConnectorStreamDefinition<unknown>

export interface BotConnectorStreamRun<Up> extends BotConnectorContext {
  readonly uplink: AsyncIterable<Up>
}

export function connectorStream<Up>(stream: BotConnectorStreamDefinition<Up>): BotConnectorStream {
  return stream as BotConnectorStream
}

export interface BotConnectorStatusSource {
  read(botId: string): ConnectorStatus
  subscribe(listener: (botId: string) => void): () => void
}

export interface BotConnectorConnections {
  readonly provider: string
  readonly scopes: readonly string[]
}

export interface BotConnectionProvider {
  readonly id: string
  readonly name: string
  readonly oauth: BotConnectionOAuth
  readonly development?: boolean
  readonly guide?: string
  identify(accessToken: string, signal: AbortSignal): Promise<ConnectionAccount>
}

export interface BotConnectionOAuth {
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly revocationEndpoint?: string
  readonly identityScopes: readonly string[]
  readonly authorizationParameters?: Readonly<Record<string, string>>
}

export interface BotConnectorConnection {
  readonly info: ConnectorConnectionInfo
  accessToken(options?: { readonly refresh?: boolean }): Promise<string>
}

export interface BotConnectorEvents {
  readonly kinds: readonly ConnectorEventKind[]
  readonly delivery: "notify" | "queue"
  readonly intervalMs: number
  poll(
    source: BotConnectorEventSource,
    cursor: ConnectorJson | undefined,
  ): Promise<BotConnectorPoll>
}

export interface BotConnectorEventSource {
  readonly connection: BotConnectorConnection
  readonly signal: AbortSignal
}

export interface BotConnectorPoll {
  readonly events: readonly ConnectorEvent[]
  readonly cursor: ConnectorJson
  readonly gap?: string
}

export interface ConnectorEvent {
  readonly key: string
  readonly kind: string
  readonly occurredAt: number
  readonly summary: string
  readonly ref: ConnectorJson
  readonly own?: boolean
}

export interface BotConnectorContext {
  readonly bot: { readonly id: string; readonly name: string }
  readonly settings: ConnectorSettingValues
  readonly environment: BotConnectorEnvironment
  readonly signal: AbortSignal
}

export interface BotConnectorPreparation {
  prepare(context: BotConnectorContext, progress: (step: string) => void): Promise<void>
  readonly hint?: ConnectorText
  unprepare?(context: BotConnectorContext): Promise<void>
}

export interface BotConnectorAttachmentSource<A> {
  open(context: BotConnectorContext): Promise<BotConnectorAttachment<A>>
}

export interface BotConnectorAttachment<A> {
  readonly value: A
  readonly ended?: Promise<unknown>
  dispose(): Promise<void>
}

export interface BotConnectorEnvironment {
  readonly workspace: string
  exec(command: BotEnvironmentCommand): Promise<BotEnvironmentCommandResult>
  spawn(process: BotEnvironmentSpawn): Promise<BotEnvironmentProcess>
  readFile(
    path: string,
    options: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ): Promise<Uint8Array>
  writeFile(
    path: string,
    data: Uint8Array,
    options?: { readonly mode?: number; readonly signal?: AbortSignal },
  ): Promise<void>
}

export interface BotEnvironmentCommand {
  readonly argv: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
}

export interface BotEnvironmentCommandResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly stdout: Uint8Array
  readonly stdoutTruncated: boolean
  readonly stderr: string
}

export interface BotEnvironmentSpawn {
  readonly argv: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

export interface BotEnvironmentProcess {
  readonly stdin: {
    write(data: Uint8Array): Promise<void>
    end(): Promise<void>
  }
  readonly stdout: AsyncIterable<Uint8Array>
  stderr(): string
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  terminate(): void
}

export interface BotConnectorAskTiming {
  readonly waitMs?: number
  readonly ttlMs?: number
}

export const DEFAULT_ASK_WAIT_MS = 60_000
export const DEFAULT_ASK_TTL_MS = 24 * 60 * 60_000
export const MAX_ASK_WAIT_MS = 10 * 60_000
export const MAX_ASK_TTL_MS = 30 * 24 * 60 * 60_000

export const DEFAULT_RESULT_CHARS = 32_000
export const MAX_RESULT_CHARS = 256_000

export type BotConnectorTrigger =
  | { readonly kind: "call" }
  | {
      readonly kind: "approval"
      readonly actionId: string
      readonly approvedAt: number
      readonly snapshot?: ConnectorJson
    }

export interface BotConnectorRun<A = undefined> extends BotConnectorContext {
  readonly trigger: BotConnectorTrigger
  readonly attachment: A
  readonly caller?: BotConnectorCaller
  readonly connection?: BotConnectorConnection
  readonly vault?: BotVaultAccess
}

export interface BotConnectorCaller {
  readonly sessionId: string
  readonly images: BotConnectorImages
}

export interface BotConnectorImages {
  admit(image: BotConnectorImageInput): Promise<BotConnectorImageAdmission>
}

export interface BotConnectorImageInput {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  readonly data: Uint8Array
  readonly name?: string
}

export type BotConnectorImageAdmission =
  | { readonly ok: true; readonly image: BotConnectorImage }
  | { readonly ok: false; readonly reason: string }

export interface BotConnectorImage {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly source: { readonly width: number; readonly height: number }
}

export interface BotConnectorResult {
  readonly text?: string
  readonly data?: ConnectorJson
  readonly images?: readonly BotConnectorImage[]
}

export type BotConnectorRecheck =
  | { readonly proceed: true }
  | { readonly proceed: false; readonly reason: string }

export interface BotConnectorJsonSchema {
  readonly type: "object"
  readonly [keyword: string]: unknown
}

export type BotConnectorJsonArgs = { readonly [key: string]: ConnectorJson }

export interface BotConnectorToolBase<Args, A> {
  readonly name: string
  readonly description: string
  readonly permission: ConnectorPermission
  readonly ask?: BotConnectorAskTiming
  readonly exclusive?: string
  readonly readOnly?: boolean
  readonly maxResultChars?: number
  readonly vault?: true
  snapshot?(args: Args, run: BotConnectorRun<A>): Promise<ConnectorJson>
  preview(args: Args, snapshot: ConnectorJson | undefined): ConnectorPreview
  recheck?(args: Args, run: BotConnectorRun<A>): Promise<BotConnectorRecheck>
  execute(args: Args, run: BotConnectorRun<A>): Promise<BotConnectorResult>
}

export interface BotConnectorTool<
  S extends ParameterSchemaSpec = ParameterSchemaSpec,
  A = undefined,
> extends BotConnectorToolBase<InferArgs<S>, A> {
  readonly parameters: S
  readonly inputSchema?: never
}

export interface BotConnectorSchemaTool<A = undefined>
  extends BotConnectorToolBase<BotConnectorJsonArgs, A> {
  readonly inputSchema: BotConnectorJsonSchema
  readonly parameters?: never
}

export type BotConnectorToolDefinition<A = undefined> =
  | BotConnectorTool<ParameterSchemaSpec, A>
  | BotConnectorSchemaTool<A>

export function connectorTools<A = undefined>() {
  return {
    tool<const S extends ParameterSchemaSpec>(
      tool: BotConnectorTool<S, A>,
    ): BotConnectorToolDefinition<A> {
      return tool as BotConnectorTool<ParameterSchemaSpec, A>
    },
    schemaTool(tool: BotConnectorSchemaTool<A>): BotConnectorToolDefinition<A> {
      return tool
    },
  }
}

export function defineConnectorTool<const S extends ParameterSchemaSpec>(
  tool: BotConnectorTool<S>,
): BotConnectorToolDefinition {
  return connectorTools().tool(tool)
}
