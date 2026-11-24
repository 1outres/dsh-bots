import type {
  BotChannelConnectionState,
  BotChannelDescriptor,
  BotChannelField,
  BotChannelListField,
  BotChannelText,
} from "./shared/channels"
import type {
  ConnectorActionView,
  ConnectorDecision,
  ConnectorDecisionResult,
} from "./shared/connectors"
import type {
  BotAnswerResult,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionClosure,
  BotInteractionKind,
} from "./shared/interactions"

export type * from "./shared/interactions"

/**
 * The channel contract: what a channel plugin (Discord, Telegram, Slack…)
 * and bot-core exchange for one bot. Everything here concerns the bot's Main
 * session only. A channel declares what it can carry
 * ({@link BotChannelCapabilities}); bot-core never sends it anything else and
 * refuses input beyond it. A channel only presents and converts: it never
 * talks to DSH's session, preset or credential services itself.
 */

/**
 * The settings a channel hands each bot's connection, by field key: a secret's
 * or text's value (`""` for an optional one left empty) or a list's items.
 * Required fields always have a value: bot-core connects only complete settings.
 */
export type BotChannelValuesOf<F extends readonly BotChannelField[]> = {
  readonly [Field in F[number] as Field["key"]]: Field extends { readonly kind: "list" }
    ? readonly string[]
    : string
}

/**
 * One messaging surface a channel plugin connects. bot-core keeps each bot's
 * settings for it (secrets in DSH's credential store), renders the settings
 * form in the browser from {@link BotChannelDescriptor.fields}, and calls
 * {@link connect} for every listed bot whose settings enable the channel and
 * are complete. A settings change closes the connection and connects again;
 * so do a bot's deletion (closed only), the channel's unregistration and
 * bot-core's unload.
 */
export interface BotChannel<F extends readonly BotChannelField[] = readonly BotChannelField[]>
  extends BotChannelDescriptor {
  readonly fields: F
  readonly owners?: BotChannelListKey<F>
  readonly capabilities: BotChannelCapabilities
  /**
   * How the channel renders the bot's messages, as one English line for the
   * bot's prompt (e.g. which Markdown shows); absent: nothing to say.
   */
  readonly formatHint?: string
  /**
   * Serve one bot through {@link link} until the returned connection is
   * closed. Report the connection's state with {@link BotChannelLink.report};
   * a throw is shown as a failed connection.
   */
  connect(link: BotChannelLink<BotChannelValuesOf<F>>): BotChannelConnection
}

/** The keys of a channel's list fields. */
export type BotChannelListKey<F extends readonly BotChannelField[]> = Extract<
  F[number],
  BotChannelListField
>["key"]

/** What a channel can carry. Anything not declared is neither sent to it nor accepted from it. */
export interface BotChannelCapabilities {
  /** Attachments a person may send with a message; absent: text only. */
  readonly attachments?: BotAttachmentCapability
  /** Files the bot may send (what its Main session presents with `present`); absent: none. */
  readonly files?: BotFileCapability
  /** Whether the channel receives turn states ({@link BotTurnState}). */
  readonly turns: boolean
  /** The interactions the channel can present and answer. */
  readonly interactions: readonly BotInteractionKind[]
  /** The operations the channel offers people (each once). */
  readonly commands: readonly BotCommandId[]
  /**
   * The channel presents connector actions to the bot's owners for a
   * decision; absent: it does not. Needs {@link BotChannel.owners}: bot-core
   * takes a decision ({@link BotChannelLink.decide}) only from a person that
   * field lists, so an empty list lets nobody decide through the channel.
   */
  readonly connectorActions?: true
}

export interface BotAttachmentCapability {
  /** Most attachments in one message. */
  readonly maxCount: number
  /** Largest attachment the channel can hand over, in bytes. */
  readonly maxBytes: number
}

export interface BotFileCapability {
  /** Largest file the channel can send, in bytes. */
  readonly maxBytes: number
}

/** A running connection of one bot to a channel: bot-core's outputs go through it. */
export interface BotChannelConnection {
  /**
   * Show one output. bot-core sends a connection one output at a time, in the
   * order the Main session produced them, the next after this one settled.
   * A rejection means the channel could not show it (for a file, the Main session is told why).
   */
  receive(output: BotChannelOutput): Promise<void>
  /** Stop serving: disconnect, cancel timers. bot-core awaits it before connecting the bot again. */
  close(): Promise<void>
}

/** What bot-core sends a channel, each kind only when its capabilities include it. */
export type BotChannelOutput =
  | { readonly kind: "reply"; readonly reply: BotReply }
  | { readonly kind: "file"; readonly file: BotOutboundFile }
  | { readonly kind: "turn"; readonly turn: BotTurnState }
  | { readonly kind: "interaction-opened"; readonly interaction: BotInteraction }
  /** An open interaction changed (a timed question's wait); same id, the whole new value. */
  | { readonly kind: "interaction-updated"; readonly interaction: BotInteraction }
  | { readonly kind: "interaction-closed"; readonly closure: BotInteractionClosure }
  /**
   * A connector action of the bot was created or changed: the whole current
   * view. It waits for a decision while pending; an ended one never changes
   * again. A connection made while some are open gets them first.
   */
  | { readonly kind: "connector-action"; readonly action: ConnectorActionView }

/** One assistant message the bot wrote in its Main session: its text blocks, without reasoning or tool calls. */
export interface BotReply {
  /** DSH's message id. */
  readonly id: string
  /** Non-empty text, blocks joined by a blank line. */
  readonly text: string
  /** The turn was cancelled while this message streamed: the text is its delivered prefix. */
  readonly interrupted: boolean
}

/** A file the bot sends from its workspace. */
export interface BotOutboundFile {
  /** The file's name, without a directory. */
  readonly name: string
  readonly data: Uint8Array
  /** Text to show with the file. */
  readonly caption?: string
}

/** A turn of the Main session began or ended, and how. */
export type BotTurnState =
  | { readonly phase: "started" }
  | { readonly phase: "completed" }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "cancelled"; readonly by: "user" | "system" }

/** Whether the bot's Main session runs a turn (DSH's Agent status). */
export type BotActivity = "idle" | "running"

/**
 * How a message enters a running Main session, as DSH's composer decides for a
 * plain Enter: `queue` (after the current turn) or `steer` (into it).
 */
export type BotDeliveryMode = "queue" | "steer"

/**
 * Where a message was written. Only direct messages so far; a channel that
 * carries rooms or threads brings its own kind with their names.
 */
export type BotMessagePlace = { readonly kind: "direct" }

/** Who wrote a message, as the channel knows them. Names may hold anything: bot-core cleans them before they reach the bot. */
export interface BotMessageSender {
  /** The channel's id of the person: what its owners field lists. */
  readonly id: string
  /** The name the channel shows for them. */
  readonly displayName: string
  /** Their unique name in the channel, without "@". */
  readonly handle: string
  /** The account is a bot. */
  readonly bot: boolean
}

/**
 * A message a person sent the bot through a channel. The channel states only
 * facts; bot-core decides whether the sender is an owner and writes the
 * header line the bot reads it with.
 */
export interface BotInboundMessage {
  readonly place: BotMessagePlace
  readonly sender: BotMessageSender
  /** When the person sent it (epoch milliseconds, the channel's own clock); names its inbox folder. */
  readonly sentAt: number
  /** The text; a message needs text or an attachment. */
  readonly text: string
  /** At most the channel's `attachments.maxCount`; none without that capability. */
  readonly attachments: readonly BotInboundAttachment[]
}

/** One file a person attached; bot-core reads it only once it accepted the message's attachments. */
export interface BotInboundAttachment {
  /** The name the person gave it (bot-core sanitizes it). */
  readonly name: string
  /** The declared media type, if the channel knows one. */
  readonly mediaType?: string
  /** The declared size in bytes. */
  readonly bytes: number
  /** Fetch the content; rejects when it is larger than `maxBytes` or cannot be read. */
  read(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
}

/** The Main session accepted the message (DSH's prompt receipt: queued in its inbox). */
export interface BotDeliveryReceipt {
  readonly sessionId: string
  readonly mode: BotDeliveryMode
  /** Attachments passed as images, the way DSH's Web composer sends them. */
  readonly images: number
  /** Where the other attachments were saved, inside the bot's environment. */
  readonly saved: readonly string[]
}

export type BotDeliveryFailureCode =
  /** The connection is closing. */
  | "closed"
  /** No text and no attachment. */
  | "empty"
  /** The bot has no Main session. */
  | "no-main-session"
  /** More attachments than the channel or bot-core allows. */
  | "too-many-attachments"
  /** One attachment, or all of them together, exceed the limits. */
  | "too-large"
  /** An attachment could not be read from the channel. */
  | "unreadable"
  /** The bot's environment cannot take files right now. */
  | "environment-unavailable"
  /** Saving a file in the bot's environment failed. */
  | "save-failed"
  /** DSH refused the prompt (e.g. the model takes no images). */
  | "rejected"

export interface BotDeliveryFailure {
  readonly code: BotDeliveryFailureCode
  /** English, for the person who sent the message. */
  readonly message: string
}

export type BotDeliveryResult =
  | { readonly delivered: true; readonly receipt: BotDeliveryReceipt }
  | { readonly delivered: false; readonly failure: BotDeliveryFailure }

/** An operation a person can run from a channel; the channel only presents it. */
export type BotCommandId = "stop" | "status" | "new"

/** Who may run a command: anyone the channel lets talk to the bot, or only its owners there. */
export type BotCommandAccess = "anyone" | "owners"

export interface BotCommandSpec {
  readonly id: BotCommandId
  readonly description: BotChannelText
  /** `owners`: bot-core runs it only for a person the channel's owners field lists. */
  readonly access: BotCommandAccess
}

/** The Main session as `status` reports it. */
export interface BotConversationStatus {
  readonly activity: BotActivity
  /** The Main session's Agent is live (not resumed yet when false: model and queue unknown). */
  readonly loaded: boolean
  readonly model?: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
  /** People's messages waiting in the Main session's inbox. */
  readonly queued: number
}

export type BotCommandResult =
  | { readonly command: "stop"; readonly outcome: "stopped" | "idle" }
  | { readonly command: "status"; readonly status: BotConversationStatus }
  /**
   * `started`: a new Main session took the place of the one the channel was
   * connected to (which is archived and kept); `unchanged`: the Main had no
   * conversation yet, so it already is a new one.
   */
  | { readonly command: "new"; readonly outcome: "started" | "unchanged" }

export type BotCommandOutcome =
  | { readonly ok: true; readonly result: BotCommandResult }
  | { readonly ok: false; readonly message: string }

/** The answer of {@link BotChannelLink.pendingActions}. */
export type BotPendingActionsResult =
  | { readonly ok: true; readonly actions: readonly ConnectorActionView[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

/**
 * What bot-core gives a channel for one bot: its settings, and its Main
 * session's inputs. After {@link signal} aborts (the connection is being
 * closed) inputs answer `closed` and reports are ignored.
 */
export interface BotChannelLink<V = BotChannelValuesOf<readonly BotChannelField[]>> {
  readonly bot: { readonly id: string; readonly name: string }
  readonly settings: V
  readonly signal: AbortSignal
  /** The commands the channel declared, in its order, with their descriptions. */
  readonly commands: readonly BotCommandSpec[]
  /**
   * Send a person's message to the Main session the way DSH's Web composer
   * sends a plain Enter: the same `session.prompt` call (a user message, a
   * fresh request id; images as image parts), queued while idle and, while a
   * turn runs, queued or steered as the user's "busy Enter" preference says.
   * Other attachments are saved in the bot's workspace inbox and named in the text.
   */
  deliver(message: BotInboundMessage): Promise<BotDeliveryResult>
  /**
   * Run one of {@link commands} for `person`, the channel's id of the one who
   * asked; a command for owners only answers `ok: false` to anyone else.
   */
  run(command: BotCommandId, person: string): Promise<BotCommandOutcome>
  /** Answer an open interaction; the first answer from anywhere wins. */
  answer(interactionId: string, answer: BotInteractionAnswer): Promise<BotAnswerResult>
  /**
   * A person started answering a timed question batch (chose something,
   * opened a text answer, asked for time): it stops counting down and waits
   * for the answer, as DSH's Web card does on the first edit.
   */
  hold(interactionId: string): Promise<BotAnswerResult>
  /**
   * A person's decision on a pending connector action, with the channel's id
   * of that person as the channel authenticated it. Taken only from one of the
   * owners the settings name ({@link BotChannel.owners}), and
   * recorded with who decided where; the first decision from anywhere wins.
   */
  decide(
    actionId: string,
    decision: ConnectorDecision,
    person: string,
  ): Promise<ConnectorDecisionResult>
  /**
   * The bot's pending connector actions, oldest first, for a person the
   * channel authenticated. Only one of the owners may read them (a preview
   * can hold personal data), as for {@link decide}.
   */
  pendingActions(person: string): BotPendingActionsResult
  /**
   * One of the bot's connector actions as the ledger keeps it now; undefined
   * once it is no longer kept, and for a channel without
   * {@link BotChannelCapabilities.connectorActions}. Outputs bring a new
   * connection the open actions only: this reads what became of an action the
   * channel showed before.
   */
  connectorAction(actionId: string): ConnectorActionView | undefined
  /** The Main session's current activity (later changes arrive as turn states). */
  activity(): BotActivity
  /** The connection's state, shown with the bot's channel settings. */
  report(state: BotChannelConnectionState): void
}
