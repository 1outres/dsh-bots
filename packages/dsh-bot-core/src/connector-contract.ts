import type { InferArgs, ParameterSchemaSpec } from "@deepseek-ai/dsh-tools"
import type { ConnectionAccount, ConnectorConnectionInfo } from "./shared/connections"
import type {
  BotCreationOption,
  ConnectorEventKind,
  ConnectorJson,
  ConnectorPanelIcon,
  ConnectorPermission,
  ConnectorPreview,
  ConnectorSessions,
  ConnectorSettingField,
  ConnectorSettingValues,
  ConnectorStatus,
  ConnectorText,
} from "./shared/connectors"
import type { BotEnvironmentMinimum } from "./shared/environment"

export type * from "./shared/connections"
export type * from "./shared/connectors"

/**
 * The connector contract (docs/specs/bot-connectors.md): what a connector
 * plugin (a desktop or browser in the bot's environment, Gmail, a calendar…)
 * gives bot-core. A connector is a definition: its tools and each tool's
 * default permission, its per-bot settings, what it needs of the bot's
 * environment and how to prepare it, and an optional resident resource per
 * bot. bot-core owns everything around it: which bots have it enabled, its
 * readiness, the permissions, the ledger of actions that ask first, the
 * notices, serialization and the images of results.
 *
 * bot-core calls every hook from its Host process, and only there: the bot
 * reaches a tool only through the tools bot-core shows its sessions, so a
 * tool that asks first cannot be called around the person's decision. Where
 * the work happens is the connector's part: a tool may drive the bot's
 * environment through {@link BotConnectorEnvironment}, or call a service with
 * credentials that stay on the Host (never put them in the environment, where
 * the bot could use them without asking).
 *
 * For each bot, every tool has a permission (its {@link BotConnectorToolBase.permission}
 * unless the bot's settings override it): `allow` runs a call at once,
 * `disallow` keeps the tool out of the bot's tool list, and `ask` stores the
 * call as a pending action with its arguments and preview. A person approves
 * or rejects it later (any time before it expires); an approved action runs
 * with exactly the stored arguments, once.
 *
 * `A` is the type of the connector's resident resource ({@link BotConnector.attachment}).
 */
export interface BotConnector<A = undefined> {
  /** Lower-case letters, digits and `_`, starting with a letter; prefixes the tools' names. */
  readonly id: string
  /** Shown to people (a product name, not translated). */
  readonly name: string
  readonly description?: ConnectorText
  /** Which sessions of a bot see and call the tools. */
  readonly sessions: ConnectorSessions
  /** The fields of its per-bot settings; none when absent. */
  readonly settings?: readonly ConnectorSettingField[]
  /**
   * The least the bot's environment must have for the connector (memory in
   * MiB, …). A bot whose spec has less cannot turn it on, and a bot with it
   * on cannot lower its spec below this; it never changes the spec itself.
   */
  readonly minimumSpec?: BotEnvironmentMinimum
  /** How the bot's environment is made ready for the connector; none needed when absent. */
  readonly preparation?: BotConnectorPreparation
  /**
   * Connectors (ids) that must be ready for the bot before this one is: a
   * bot turns it on only after them and turns them off only after it. It
   * waits while they prepare, is unavailable while one is off, missing or
   * failed, prepares again whenever one became ready again, and leaves ready
   * when one does. While a
   * person operates one of them (its status says `operatedBy`), only this
   * connector's `readOnly` tools run.
   */
  readonly requires?: readonly string[]
  /**
   * The New bot dialog's option it belongs to: a bot created with that option
   * on starts with every registered connector of the option enabled. Every
   * other bot starts with it off until a person enables it.
   */
  readonly creationOption?: BotCreationOption
  /** A resource kept per bot while the connector is ready (a connection, a process). */
  readonly attachment?: BotConnectorAttachmentSource<A>
  /**
   * The outside accounts its tools act as (docs/specs/bot-connectors.md 10).
   * Every tool then takes an `account` argument that bot-core adds to its
   * schema and resolves to one of the bot's accounts ({@link BotConnectorRun.connection});
   * the tool's own hooks never see that argument. bot-core also gives such a
   * connector the `<id>_accounts` tool.
   */
  readonly connections?: BotConnectorConnections
  /** Changes in its accounts it reports (a new email, a changed event), polled by bot-core. */
  readonly events?: BotConnectorEvents
  readonly tools: readonly BotConnectorToolDefinition<A>[]
  /** What a person uses directly, beside the tools: a panel in the bot's shell and the streams it opens. */
  readonly panel?: BotConnectorPanel
  /** What the connector says about itself per bot (shown in the bot's shell and settings). */
  readonly status?: BotConnectorStatusSource
}

/**
 * The connector's panel in a bot's shell (beside Files). bot-core shows its
 * button and frame for every bot, and the connector's readiness while it is
 * not ready; once ready, the connector's own browser part draws the body (the
 * `bot-core.connector.panel` Slot, keyed by the connector's id) and opens
 * {@link streams} through bot-core's `botConnectorStreams` Remote.
 */
export interface BotConnectorPanel {
  readonly title: ConnectorText
  /** Its menu bar button's glyph, one bot-core draws. */
  readonly icon: ConnectorPanelIcon
  readonly streams: readonly BotConnectorStream[]
}

/**
 * One stream a panel opens for a person: bot-core checks that the caller is
 * the DSH Host's owner and the connector is ready for the bot, then serves it
 * with {@link BotConnectorStreamDefinition.open}. Every item the browser sends
 * goes through `parse` first.
 */
export interface BotConnectorStreamDefinition<Up> {
  /** Lower-case letters, digits, `_` and `-`, starting with a letter; unique in the panel. */
  readonly name: string
  /** Check one item from the browser (untrusted). A throw fails the stream. */
  parse(item: unknown): Up
  /** Serve one viewer until it ends or `stream.signal` aborts. */
  open(stream: BotConnectorStreamRun<Up>): AsyncIterable<ConnectorJson>
}

/** A stream definition with its uplink type erased, as a panel lists it. */
export type BotConnectorStream = BotConnectorStreamDefinition<unknown>

/**
 * One viewer's stream. `signal` aborts when the viewer leaves, the connector
 * leaves `ready` for the bot (disabled, settings changed, the environment
 * ensured again), it unregisters, the bot is deleted or bot-core unloads.
 */
export interface BotConnectorStreamRun<Up> extends BotConnectorContext {
  /** The browser's items, each parsed; ends when the browser ends its side. */
  readonly uplink: AsyncIterable<Up>
}

/** A panel stream, its uplink typed from `parse`. */
export function connectorStream<Up>(stream: BotConnectorStreamDefinition<Up>): BotConnectorStream {
  return stream as BotConnectorStream
}

/**
 * The connector's state for people, per bot; the connector owns it, bot-core
 * reads it while the connector is enabled for the bot and after every change.
 */
export interface BotConnectorStatusSource {
  read(botId: string): ConnectorStatus
  /** Called with the bot after its status changed. */
  subscribe(listener: (botId: string) => void): () => void
}

/** A connector's accounts: connections of a registered provider, with the scopes the connector needs. */
export interface BotConnectorConnections {
  /** A {@link BotConnectionProvider} id. */
  readonly provider: string
  /** Scopes an account must grant for the connector to use it. */
  readonly scopes: readonly string[]
}

/**
 * A provider of connections: what bot-core needs to sign an account in with
 * OAuth 2.0 (authorization code with PKCE, a confidential Web client) and to
 * refresh its access. bot-core runs the flow and keeps the tokens on the Host;
 * the provider only names its endpoints and identifies an account.
 */
export interface BotConnectionProvider {
  /** Lower-case letters, digits and `-`, starting with a letter. */
  readonly id: string
  /** Shown to people (a product name). */
  readonly name: string
  readonly oauth: BotConnectionOAuth
  /** Its endpoints are a development configuration (a fake provider), shown as such. */
  readonly development?: boolean
  /** An https page that walks through setting up its OAuth client. */
  readonly guide?: string
  /** The account an access token acts as. */
  identify(accessToken: string, signal: AbortSignal): Promise<ConnectionAccount>
}

export interface BotConnectionOAuth {
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  /** Where a refresh token is revoked when its connection is removed. */
  readonly revocationEndpoint?: string
  /** Scopes asked of every account besides the connectors' (its identity). */
  readonly identityScopes: readonly string[]
  /** Further query parameters of the authorization request (one that yields a refresh token). */
  readonly authorizationParameters?: Readonly<Record<string, string>>
}

/** The account one run acts as. */
export interface BotConnectorConnection {
  readonly info: ConnectorConnectionInfo
  /**
   * A current access token, kept on the Host and refreshed when needed.
   * `refresh` asks for a new one (the service refused the last one).
   * @throws when the account must be signed in again (bot-core marks it so).
   */
  accessToken(options?: { readonly refresh?: boolean }): Promise<string>
}

/**
 * A connector's events. bot-core polls every account of the connector that
 * some bot receives events of, every `intervalMs` and once at start-up;
 * stores the events (deduplicated by key) before it keeps the new cursor, and
 * delivers them as each bot's settings say.
 */
export interface BotConnectorEvents {
  readonly kinds: readonly ConnectorEventKind[]
  /** How a bot gets them when its owner turns them on. */
  readonly delivery: "notify" | "queue"
  /** At least 10 s. */
  readonly intervalMs: number
  /**
   * What changed since `cursor` (undefined: the first poll, which only
   * marks where to start; its events are ignored). When the service no
   * longer has the history since `cursor`, start again from now and say
   * why in `gap`: bot-core tells the bot that events may have been missed.
   */
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

/** One change in an account, as short as a notice line: the bot reads the rest with the connector's tools. */
export interface ConnectorEvent {
  /** Equal for the same change, whichever poll reports it. */
  readonly key: string
  /** One of the connector's `kinds`. */
  readonly kind: string
  readonly occurredAt: number
  /** Who, what and an excerpt; outside text, never instructions. */
  readonly summary: string
  /** What the connector's tools take to read it (a message id). */
  readonly ref: ConnectorJson
  /** The result of the bot's own operation: kept, never told. */
  readonly own?: boolean
}

/** What every hook gets: the bot, its settings of the connector, its environment and an abort signal. */
export interface BotConnectorContext {
  readonly bot: { readonly id: string; readonly name: string }
  readonly settings: ConnectorSettingValues
  readonly environment: BotConnectorEnvironment
  readonly signal: AbortSignal
}

/**
 * Making the bot's environment ready for the connector (packages, services,
 * files). bot-core runs it whenever the connector is enabled for a bot and
 * the bot's environment is ready:
 * at start-up, after the environment was ensured again (it may be a new VM),
 * and after a settings change. Runs for one bot never overlap, across
 * connectors either. A rejection marks the connector failed for the bot and
 * is retried with backoff.
 */
export interface BotConnectorPreparation {
  /**
   * Install, configure, start and check what the connector needs; idempotent.
   * `progress` names the step it is at (English, shown to people with the
   * time it has taken so far).
   */
  prepare(context: BotConnectorContext, progress: (step: string) => void): Promise<void>
  /** What people read while it prepares, such as how long a first preparation takes. */
  readonly hint?: ConnectorText
  /**
   * Stop what `prepare` started, when the connector is disabled for the bot;
   * the bot's data (a browser profile) stays. A rejection is only logged.
   */
  unprepare?(context: BotConnectorContext): Promise<void>
}

/**
 * Opens the connector's resident resource for one bot, at the first run
 * that needs it once the connector is ready. bot-core disposes it when the
 * connector leaves `ready` for the bot (disabled, settings changed, the
 * environment ensured again), the connector unregisters, the bot is deleted
 * or bot-core unloads; and forgets it once `ended` settles (the next run opens
 * a new one). A call is never repeated on a new resource.
 */
export interface BotConnectorAttachmentSource<A> {
  open(context: BotConnectorContext): Promise<BotConnectorAttachment<A>>
}

export interface BotConnectorAttachment<A> {
  readonly value: A
  /** Settles when the resource stopped working by itself (its process exited). */
  readonly ended?: Promise<unknown>
  dispose(): Promise<void>
}

/**
 * The bot's environment as a connector reaches it: commands and files run as
 * the bot's own user in its environment (its VM), never on the Host. Every
 * method rejects while the bot's environment is not available.
 */
export interface BotConnectorEnvironment {
  /** The environment's workspace, the working directory of every bot session. */
  readonly workspace: string
  /** Run a command to its end, its output collected. */
  exec(command: BotEnvironmentCommand): Promise<BotEnvironmentCommandResult>
  /** Start a process whose input and output the caller streams (a protocol, a byte relay). */
  spawn(process: BotEnvironmentSpawn): Promise<BotEnvironmentProcess>
  /** @throws when the file is larger than `maxBytes` or cannot be read. */
  readFile(
    path: string,
    options: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ): Promise<Uint8Array>
  /** Replace the file atomically (written beside it, then renamed). */
  writeFile(
    path: string,
    data: Uint8Array,
    options?: { readonly mode?: number; readonly signal?: AbortSignal },
  ): Promise<void>
}

export interface BotEnvironmentCommand {
  /** The program and its arguments; never interpreted by a shell. */
  readonly argv: readonly string[]
  /** Default: the workspace. */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
  /** The command is stopped after this long and the result says `timedOut`. */
  readonly timeoutMs: number
  /** Largest standard output kept (its head); stderr keeps its last 16 KiB. */
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
}

export interface BotEnvironmentCommandResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly stdout: Uint8Array
  /** Whether standard output was longer than `maxOutputBytes`. */
  readonly stdoutTruncated: boolean
  readonly stderr: string
}

export interface BotEnvironmentSpawn {
  readonly argv: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  /** Aborting stops the process. */
  readonly signal: AbortSignal
}

export interface BotEnvironmentProcess {
  readonly stdin: {
    write(data: Uint8Array): Promise<void>
    end(): Promise<void>
  }
  readonly stdout: AsyncIterable<Uint8Array>
  /** The last 16 KiB of its standard error so far. */
  stderr(): string
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  terminate(): void
}

/** How long an `ask` call waits for a decision, and how long its action stays pending. */
export interface BotConnectorAskTiming {
  /**
   * How long the call waits, in milliseconds, before it returns "awaiting
   * approval" and the bot goes on; a decision within it answers the call
   * itself. Default {@link DEFAULT_ASK_WAIT_MS}.
   */
  readonly waitMs?: number
  /** How long the action may be decided, in milliseconds. Default {@link DEFAULT_ASK_TTL_MS}. */
  readonly ttlMs?: number
}

export const DEFAULT_ASK_WAIT_MS = 60_000
export const DEFAULT_ASK_TTL_MS = 24 * 60 * 60_000
export const MAX_ASK_WAIT_MS = 10 * 60_000
export const MAX_ASK_TTL_MS = 30 * 24 * 60 * 60_000

/** Default and largest {@link BotConnectorToolBase.maxResultChars}. */
export const DEFAULT_RESULT_CHARS = 32_000
export const MAX_RESULT_CHARS = 256_000

/** What started a run of a tool. */
export type BotConnectorTrigger =
  | { readonly kind: "call" }
  | {
      readonly kind: "approval"
      readonly actionId: string
      readonly approvedAt: number
      /** What the tool's `snapshot` read when the action was created. */
      readonly snapshot?: ConnectorJson
    }

/** One run of a connector tool. */
export interface BotConnectorRun<A = undefined> extends BotConnectorContext {
  readonly trigger: BotConnectorTrigger
  /** The connector's resident resource for the bot (opened before the run when it has one). */
  readonly attachment: A
  /** The Agent's session that called, for a `call`; an approved action runs for no one. */
  readonly caller?: BotConnectorCaller
  /** The account the call acts as, for a connector with {@link BotConnector.connections}. */
  readonly connection?: BotConnectorConnection
}

export interface BotConnectorCaller {
  readonly sessionId: string
  /** Images for the calling model, to return in the result. */
  readonly images: BotConnectorImages
}

export interface BotConnectorImages {
  /**
   * Store an image for the calling model. It succeeds only when the model
   * takes images; the admitted image's size is what the model sees (it may be
   * scaled down), so coordinates the model gives refer to it.
   */
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
  /** The size the model sees, in pixels. */
  readonly width: number
  readonly height: number
  /** The size of the image as given. */
  readonly source: { readonly width: number; readonly height: number }
}

/**
 * What a tool returns: text the model reads (a page snapshot), data shown as
 * JSON, and images admitted in this run. An approved action's result keeps
 * its text and data only.
 */
export interface BotConnectorResult {
  readonly text?: string
  readonly data?: ConnectorJson
  readonly images?: readonly BotConnectorImage[]
}

/** The verdict of a tool's check right before an approved action runs. */
export type BotConnectorRecheck =
  | { readonly proceed: true }
  | { readonly proceed: false; readonly reason: string }

/** A JSON Schema object of a tool's arguments, as an MCP server declares one. */
export interface BotConnectorJsonSchema {
  readonly type: "object"
  readonly [keyword: string]: unknown
}

/** Arguments of a tool declared with a JSON Schema: any JSON object it accepts. */
export type BotConnectorJsonArgs = { readonly [key: string]: ConnectorJson }

export interface BotConnectorToolBase<Args, A> {
  /** Lower-case letters, digits and `_`, starting with a letter; unique in the connector. */
  readonly name: string
  /** For the model. */
  readonly description: string
  /** The permission of a bot that does not override it; every tool states its own. */
  readonly permission: ConnectorPermission
  readonly ask?: BotConnectorAskTiming
  /**
   * Calls of the connector's tools with the same key run one at a time per
   * bot (one screen, one input device); others run alongside.
   */
  readonly exclusive?: string
  /**
   * The tool only reads (a snapshot, a screenshot), so it also runs while a
   * person operates a connector this one {@link BotConnector.requires}.
   */
  readonly readOnly?: boolean
  /** Largest text and data (as JSON) of a result, in characters; more is cut. */
  readonly maxResultChars?: number
  /**
   * Only for what a preview cannot show from the arguments alone (the message
   * a reply quotes): read it when an `ask` call becomes an action, with I/O.
   * It is stored with the action, shown through `preview`, and handed to
   * `recheck` and the approved run in their trigger. Never called for `allow`.
   */
  snapshot?(args: Args, run: BotConnectorRun<A>): Promise<ConnectorJson>
  /**
   * What a person decides on, generated from the arguments and the snapshot
   * without I/O. Every tool has one: a person may set any tool to `ask`.
   */
  preview(args: Args, snapshot: ConnectorJson | undefined): ConnectorPreview
  /**
   * Optional check right before an approved action runs (the world may have
   * changed in the hours since): `proceed: false` fails the action with the reason.
   */
  recheck?(args: Args, run: BotConnectorRun<A>): Promise<BotConnectorRecheck>
  /** Do the work. A rejection fails the run with its message. */
  execute(args: Args, run: BotConnectorRun<A>): Promise<BotConnectorResult>
}

/** A tool with dsh-tools' parameter schema; calls are validated against it before anything else. */
export interface BotConnectorTool<
  S extends ParameterSchemaSpec = ParameterSchemaSpec,
  A = undefined,
> extends BotConnectorToolBase<InferArgs<S>, A> {
  readonly parameters: S
  readonly inputSchema?: never
}

/** A tool with a JSON Schema of its arguments (an MCP server's), validated the same way. */
export interface BotConnectorSchemaTool<A = undefined>
  extends BotConnectorToolBase<BotConnectorJsonArgs, A> {
  readonly inputSchema: BotConnectorJsonSchema
  readonly parameters?: never
}

/** One tool as a connector lists it. */
export type BotConnectorToolDefinition<A = undefined> =
  | BotConnectorTool<ParameterSchemaSpec, A>
  | BotConnectorSchemaTool<A>

/**
 * Tool definers of a connector whose resident resource is `A`: `tool` types
 * the hooks' arguments from the parameter schema; `schemaTool` takes a JSON
 * Schema.
 */
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

/** A tool of a connector without a resident resource, its arguments typed from its parameter schema. */
export function defineConnectorTool<const S extends ParameterSchemaSpec>(
  tool: BotConnectorTool<S>,
): BotConnectorToolDefinition {
  return connectorTools().tool(tool)
}
