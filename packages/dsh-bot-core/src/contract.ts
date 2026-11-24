import type { Context } from "@deepseek-ai/cordis"
import type { BotChannel } from "./channel-contract"
import type { BotConnectionProvider, BotConnector } from "./connector-contract"
import type { MainPreparation } from "./mains-contract"
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
import type { BotWebBackend } from "./web-contract"

/**
 * Contract other packages of this repository import from `@1outres/dsh-bot-core`:
 * the `bot` service. A channel plugin injects it and reads it with
 * {@link botOf}; it never talks to DSH's session or preset services itself.
 *
 * Guarantees bot-core keeps for every bot:
 * - Its Agent preset is `bot-<botId>`, composed from the bot's template and
 *   overlay inside the registered {@link BotEnvironment}'s group, and
 *   registered only while it matches them and the environment is ready.
 * - Every session of a bot runs in the environment's
 *   {@link BotEnvironment.workspace}, never in a Host directory, and belongs
 *   to the bot by identity (its session header names the bot's preset, or,
 *   for a subagent, its live parent belongs to the bot).
 * - An Agent of a bot's session runs that bot's preset, and an Agent on a
 *   bot's preset belongs to a session of that bot; otherwise it is locked
 *   down (no tool runs). Bot Agents see Host tools only through `hostTools`.
 */

export type * from "./channel-contract"
export * from "./connector-contract"
export type * from "./connector-panel-contract"
export type * from "./mains-contract"
export type * from "./web-contract"

/** Cordis service key the core registers; channel plugins put it in `inject`. */
export const BOT_SERVICE = "bot"

/**
 * Who a bot is to its environment. There is no Host path: a bot's files live
 * only in its environment, under {@link BotEnvironment.workspace}.
 */
export interface BotEnvironmentBot {
  readonly id: string
  readonly name: string
}

/** What `ensure` makes the bot's environment: the bot's, with its stored spec. */
export interface BotEnvironmentTarget extends BotEnvironmentBot {
  /**
   * The machine the environment gives the bot, set in its own settings (never
   * through shared defaults such as a profile). A new environment is created
   * with it; an existing one that has other values is stopped, changed and
   * started again. bot-core changes it only when a person saves it.
   */
  readonly spec: BotEnvironmentSpec
}

export type * from "./shared/environment"

/** How one `ensure` runs: bot-core may abort it, and shows its progress to the user. */
export interface EnsureOptions {
  readonly signal?: AbortSignal
  /**
   * Report the step the environment is at. Steps it does not need (a VM that
   * exists, one that runs) are skipped; reporting an earlier step again is fine.
   */
  readonly progress?: (phase: EnvironmentPhase) => void
}

/**
 * Execution environment provider (e.g. one VM per bot). At most one is
 * registered at a time, and only the id bot-core's `environment` config names
 * (default "incus-vm"). Without one, no bot preset is registered (fail closed).
 *
 * The provider's responsibilities: it serializes the calls for one bot (an
 * `ensure` that bot-core aborted may still be running when `remove` or the
 * next `ensure` arrives); and it may, at start-up, clean up environments of
 * bots that `Bot.bots()` no longer lists (bot-core retries `remove` only in
 * memory, while an environment is registered).
 */
export interface BotEnvironment {
  /** Stable id, e.g. "incus-vm". */
  readonly id: string
  /** Service names the rows provide inside the bot's group; bot-core isolates each of them. */
  readonly isolate: readonly string[]
  /**
   * Absolute, normalized directory inside the environment (the same for every
   * bot, e.g. "/home/bot/workspace") that is the working directory of every
   * bot session: sessions are created there, and bot-core validates a bot
   * Agent's working directory with the environment's own file system, never
   * the Host's. `registerEnvironment` refuses a relative or unnormalized path.
   */
  readonly workspace: string
  /**
   * Make the bot's environment exist and run. Idempotent; safe to call concurrently for
   * different bots; for the same bot calls may overlap (provider serializes). Resolves when
   * rows(target) can be mounted. Rejects with a human-readable Error when it cannot.
   */
  ensure(target: BotEnvironmentTarget, options?: EnsureOptions): Promise<void>
  /**
   * What the environment accepts for each key of the bot's spec, from the
   * Host it runs on and what the other environments there already take.
   * bot-core checks every changed key against it before it stores a spec,
   * and makes a new bot's spec from it, asked with the new bot's id before
   * the bot has an environment (or for an id no bot has, for the New bot
   * dialog); `ensure` rejects a spec it cannot give.
   */
  capacity(botId: string, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  /**
   * The spec the bot's existing environment runs with (what its CPUs, memory
   * and disk are now), or undefined when it has none. bot-core reads it once
   * for a bot stored before specs, and stores it as the bot's spec, so that
   * bot keeps the machine it has.
   * @throws when it cannot tell a value (e.g. a size it cannot read).
   */
  inspect(botId: string, signal?: AbortSignal): Promise<BotEnvironmentSpec | undefined>
  /**
   * Destroy the bot's environment (VM, keys, ssh config), its workspace data
   * included. Idempotent. A rejection is retried with backoff.
   */
  remove(botId: string): Promise<void>
  /**
   * Service-provider rows of the bot's execution group (ssh, fs, subprocess, shell, sandboxPolicy…).
   * Pure and synchronous. bot-core places them first in the group, before the composed template rows.
   * Row ids must start with "env-".
   */
  rows(bot: BotEnvironmentBot): readonly PluginRow[]
  /** Optional: observe readiness changes (e.g. VM stopped); bot-core recomposes/marks the preset. */
  onChange?(listener: (botId: string) => void): () => void
}

/** What other plugins see of the registered environment. */
export interface BotEnvironmentInfo {
  readonly id: string
  readonly isolate: readonly string[]
  readonly workspace: string
}

/**
 * Which of the bot's models a new session starts on (docs/specs/bot-models.md,
 * docs/specs/bot-managed-sessions.md §6): its `main` role, or one of its
 * `delegates`, named by the same choice.
 */
export type BotSessionModelRequest =
  | { readonly role: "main" }
  | { readonly role: "delegate"; readonly choice: BotModelChoice }

export interface BotSessionOptions {
  readonly title?: string
  /** Absent: `{ role: "main" }`. */
  readonly model?: BotSessionModelRequest
}

/** A preset change: the template to compose from and/or the whole new overlay. */
export interface BotPresetChange {
  readonly template?: string
  readonly overlay?: BotOverlay
}

export interface Bot {
  /** Bots defined in the Web UI, oldest first. */
  bots(): readonly BotView[]
  /**
   * Every stored bot: listed ones, and those being created or whose creation
   * failed (no Main session yet). An environment keeps the resources of all of them.
   */
  botIds(): readonly string[]
  /**
   * Register a channel; the returned function unregisters it (its connections close).
   * @throws when its descriptor is invalid or its id is taken.
   */
  registerChannel<F extends readonly BotChannelField[]>(channel: BotChannel<F>): () => void
  /** Channels registered right now, by id. */
  channels(): readonly BotChannel[]

  /**
   * Register a connector; the returned function unregisters it (its tools
   * leave every bot's tool list, its resident resources are disposed; its
   * pending actions stay and may still be decided, and an approved one runs
   * once it is registered and ready again). A connector is off for every bot
   * until a person enables it ({@link configureConnector}).
   * @throws when its descriptor is invalid or its id or a tool name is taken.
   */
  registerConnector<A>(connector: BotConnector<A>): () => void
  /** Connectors registered right now. */
  connectors(): readonly BotConnector<unknown>[]
  /**
   * Register a provider of connections (an OAuth service such as Google);
   * the returned function unregisters it. Its accounts are signed in by the
   * owner in the Web UI, their tokens kept on the Host, and connectors whose
   * `connections.provider` names it act as them.
   * @throws when it is invalid or its id is taken.
   */
  registerConnectionProvider(provider: BotConnectionProvider): () => void
  /** Providers registered right now. */
  connectionProviders(): readonly BotConnectionProvider[]
  /** The bot's state of every registered connector: enabled, settings, readiness, permissions. @throws for an unknown bot. */
  connectorStates(botId: string): readonly BotConnectorView[]
  /**
   * Enable or disable a connector for the bot and store its settings
   * (validated against its fields, as untrusted input); its readiness follows.
   * @throws for an unknown bot or connector, or an invalid change; for turning
   * it on while a connector it requires is off or not registered, or off
   * while a connector requiring it is on (`connectorSwitchBlock`).
   */
  configureConnector(
    botId: string,
    connectorId: string,
    change: BotConnectorChange,
  ): Promise<BotConnectorView>
  /** Prepare a failed connector of the bot again now. @throws for an unknown bot or connector. */
  retryConnector(botId: string, connectorId: string): BotConnectorView
  /** Called with the bot id after any of its connector states changed. */
  onConnectorStateChange(listener: (botId: string) => void): () => void
  /** Every registered connector tool's permission for the bot. @throws for an unknown bot. */
  connectorPermissions(botId: string): readonly ConnectorToolPermission[]
  /**
   * Override (or, with `null`, reset) the bot's permission of one tool; the
   * bot's Agents see the change at their next step.
   * @throws for an unknown bot or tool, or a malformed change.
   */
  setConnectorPermission(
    botId: string,
    change: ConnectorPermissionChange,
  ): Promise<readonly ConnectorToolPermission[]>
  /**
   * The bot's connector actions (open ones, and ended ones for a while), oldest
   * first, read-only. Only the bot's owner decides them, in the Web UI or
   * through a channel's approvers ({@link BotChannelLink.decide}); no Host API does.
   * @throws for an unknown bot.
   */
  connectorActions(botId: string): readonly ConnectorAction[]
  /** Observe every created or changed connector action; returns the unsubscriber. */
  onConnectorActionChange(listener: (change: ConnectorActionChange) => void): () => void

  /**
   * Register a bot template; the returned function unregisters it. Bots on
   * that template are recomposed. Throws on an invalid template or a duplicate id.
   */
  registerTemplate(template: BotTemplate): () => void
  /** Templates registered right now, the built-in `default` included. */
  templates(): readonly BotTemplate[]
  /** State of a bot's composed Agent preset, or `undefined` for an unknown bot. */
  presetOf(botId: string): BotPresetState | undefined
  /**
   * Observe preset states: called with the bot id after its state changed
   * (registered, re-registered, failed, removed). Returns the unsubscriber,
   * which the caller owns; {@link watchBotPresets} ties it to a context.
   */
  onPresetChange(listener: (botId: string) => void): () => void
  /**
   * Check a change against the current templates without storing it.
   * An overlay is validated like {@link configurePreset} validates it.
   * @throws when the bot does not exist or the overlay is malformed.
   */
  previewPreset(botId: string, change: BotPresetChange): BotPresetPreview
  /**
   * Choose the bot's template and/or replace its overlay, then recompose its
   * preset. The merged result is validated before it is stored; nothing is
   * stored when it does not compose. Live Agents keep the revision they
   * started with.
   *
   * Trust boundary: the overlay is treated as untrusted input (it may come
   * from a chat message or the browser). It may not carry Loader `!!js`
   * expressions, and its rows may only name plugins that registered templates
   * use or that bot-core's `allowedPlugins` config lists — never a path, URL or
   * include row, which the Loader would import or evaluate on the Host.
   * Templates, declared in the profile, are trusted (`!!js` and any plugin
   * package), except for what would escape the bot environment.
   */
  configurePreset(botId: string, change: BotPresetChange): Promise<BotPresetState>
  /**
   * Start a session for a bot: it runs in the environment's workspace under
   * the bot's composed preset, and is recorded as the bot's. Rejects while
   * that preset is not ready. Channel plugins and bot-core's own UI start bot
   * sessions only through here; a bot session switched to another preset is
   * locked down. A delegate model the bot's `delegates` do not hold is
   * refused (`bot-models/not-delegate`) and nothing is created.
   */
  createSession(botId: string, options?: BotSessionOptions): Promise<{ sessionId: string }>

  /**
   * The bot's model of every role (docs/specs/bot-models.md): `main` (its
   * Main session and {@link createSession}), `utility` and `delegates`.
   * @throws for an unknown bot.
   */
  models(botId: string): BotModelsView
  /**
   * Replace the roles the change names (untrusted input: checked like the
   * `bots` Remote's `configureModels`; each fixed route against DSH's LLM
   * registry, nothing stored when one is refused). Naming `main` applies it
   * to the Main session once its Agent is loaded; other live sessions keep
   * their model.
   */
  configureModels(botId: string, change: BotModelsChange): Promise<BotModelsView>
  /** DSH's registered providers, their advertised models and efforts, and its default model. */
  modelCatalog(): Promise<BotModelCatalog>
  /**
   * The route a choice names now (`profile-default`: DSH's default model),
   * checked against DSH's LLM registry.
   * @throws when DSH cannot run it.
   */
  resolveModel(choice: BotModelChoice): Promise<BotModelSelection>
  /** Called with the bot id after its models changed; returns the unsubscriber. */
  onModelsChange(listener: (botId: string) => void): () => void

  /**
   * Register the execution environment every bot runs in; the returned
   * function unregisters it (bot presets are then unregistered: fail closed).
   * Each bot's preset is registered once `ensure` resolved for it, with the
   * environment's rows first in an isolated `bot-environment` group that holds
   * the whole composition.
   * @throws when an environment is already registered, its id is not the
   *   one bot-core's `environment` config names, or its `workspace` is not an
   *   absolute, normalized path.
   */
  registerEnvironment(environment: BotEnvironment): () => void
  /**
   * Take part in the preparation stage of every bot's Main maintenance (an
   * idle compaction, a new Main): `prepare` runs after bot-core decided and
   * before it acts, and a rejection gives the maintenance up this time
   * (docs/specs/bot-main-rotation.md §9). The returned function unregisters it.
   * @throws when its id is empty or taken.
   */
  registerMainPreparation(preparation: MainPreparation): () => void

  /** The registered environment's id, isolated services and workspace, if any (read-only). */
  environment(): BotEnvironmentInfo | undefined

  /**
   * Register a web lookup backend; the returned function unregisters it. The
   * one the web settings name serves every bot's `web_search` / `web_fetch`.
   * Its secrets and which capabilities are on are set in the dsh-bots
   * settings (the `botWeb` Remote), never here.
   * @throws when the descriptor is invalid or its id is taken.
   */
  registerWebBackend(backend: BotWebBackend): () => void
  /** Web backends registered right now, in registration order. */
  webBackends(): readonly BotWebBackend[]
  /** Whether bots can search and fetch now, and why not. */
  webStatus(): BotWebStatus
  /** Called after the web settings, the backends or their secrets changed; returns the unsubscriber. */
  onWebChange(listener: () => void): () => void
}

/**
 * Observe bot preset states for as long as `ctx` lives: the subscription is
 * an effect of `ctx`, so it ends with the plugin that made it.
 */
export function watchBotPresets(ctx: Context, listener: (botId: string) => void): void {
  ctx.effect(() => botOf(ctx).onPresetChange(listener), "bot: preset changes")
}

/**
 * The `bot` service of a context that injects it. Augmenting cordis' `Context`
 * interface breaks its declaration merging under this repository's TypeScript,
 * so services are read through `ctx.get` instead.
 */
export function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT_SERVICE) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT_SERVICE}" service is not available; inject it`)
  return bot
}
