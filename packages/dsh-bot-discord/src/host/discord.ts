/**
 * The contract between the channel's logic and a Discord client library: the
 * events and actions the logic uses, in plain data. src/host/discordjs/
 * implements it with discord.js; nothing else here imports the library.
 */

/** Upper bound of the messages one {@link DiscordActions.messagesAfter} call returns. */
export const MESSAGES_PAGE_LIMIT = 100

export interface DiscordAccount {
  readonly id: string
  /** "name", or "name#1234" for a legacy account. */
  readonly tag: string
}

/** `default` and `reply` are what a person writes; `other` covers pins, calls and every other system or bot message. */
export type DiscordMessageKind = "default" | "reply" | "other"

export interface DiscordAuthor {
  readonly id: string
  /** The account's unique name ("name"; "name" of a legacy "name#1234"). */
  readonly username: string
  /** The name Discord shows for the account where it wrote (its server nickname, its global display name, else its username). */
  readonly displayName: string
  readonly bot: boolean
}

export interface DiscordAttachment {
  readonly name: string
  /** Discord's CDN link, which expires. */
  readonly url: string
  /** Size in bytes, as Discord reports it. */
  readonly size: number
  /** Media type, as Discord reports it (null when it does not know). */
  readonly contentType: string | null
}

export interface DiscordMessage {
  readonly id: string
  readonly channelId: string
  /** `null` in a direct message. */
  readonly guildId: string | null
  /** The names of the server and the channel; `null` in a direct message. */
  readonly server: { readonly name: string; readonly channel: string } | null
  readonly kind: DiscordMessageKind
  readonly author: DiscordAuthor
  readonly content: string
  readonly attachments: readonly DiscordAttachment[]
  /** When it was posted (epoch milliseconds). */
  readonly createdAt: number
}

/** A file the bot uploads with a message. */
export interface DiscordFile {
  readonly name: string
  readonly data: Uint8Array
}

export type DiscordButtonStyle = "primary" | "secondary" | "success" | "danger"

export interface DiscordButton {
  readonly kind: "button"
  /** At most {@link CUSTOM_ID_LIMIT} characters. */
  readonly customId: string
  /** At most 80 characters. */
  readonly label: string
  readonly style: DiscordButtonStyle
  readonly disabled: boolean
}

export interface DiscordSelectOption {
  readonly value: string
  /** At most 100 characters. */
  readonly label: string
  /** At most 100 characters. */
  readonly description?: string
  readonly selected: boolean
}

/** A string select menu: at most {@link SELECT_OPTION_LIMIT} options. */
export interface DiscordSelect {
  readonly kind: "select"
  readonly customId: string
  readonly placeholder?: string
  readonly minValues: number
  readonly maxValues: number
  readonly options: readonly DiscordSelectOption[]
  readonly disabled: boolean
}

export type DiscordComponent = DiscordButton | DiscordSelect

/** One action row: up to {@link ROW_BUTTON_LIMIT} buttons, or one select menu. */
export type DiscordComponentRow = readonly DiscordComponent[]

/** Discord's limits on message components. */
export const CUSTOM_ID_LIMIT = 100
export const ROW_BUTTON_LIMIT = 5
export const MESSAGE_ROW_LIMIT = 5
export const SELECT_OPTION_LIMIT = 25

export interface DiscordEmbed {
  /** At most 256 characters. */
  readonly title?: string
  /** At most 4096 characters. */
  readonly description?: string
}

/** A message the bot posts. Mentions in it never ping anyone. */
export interface DiscordOutgoingMessage {
  /** May be empty when the message carries files or embeds. */
  readonly content: string
  readonly files?: readonly DiscordFile[]
  readonly embeds?: readonly DiscordEmbed[]
  readonly components?: readonly DiscordComponentRow[]
  /** The message it answers (shown as a reply; posted anyway when that message is gone). */
  readonly replyTo?: string
}

/** What replaces a message the bot posted (its files stay, and its embeds when `embeds` is absent). */
export interface DiscordMessageEdit {
  readonly content: string
  readonly embeds?: readonly DiscordEmbed[]
  readonly components: readonly DiscordComponentRow[]
}

/** A modal with one paragraph text input. */
export interface DiscordTextModal {
  readonly customId: string
  /** At most 45 characters. */
  readonly title: string
  readonly input: {
    /** At most 45 characters. */
    readonly label: string
    readonly required: boolean
    readonly maxLength: number
    readonly value?: string
    readonly placeholder?: string
  }
}

/** A slash command the bot offers at its home. */
export interface DiscordCommandSpec {
  /** Lowercase, as Discord requires. */
  readonly name: string
  /** English, at most 100 characters. */
  readonly description: string
  readonly descriptionJa?: string
}

/** What answers a command: shown to the invoker only when `ephemeral`. */
export interface DiscordCommandResponse {
  /** May be empty when the response carries embeds. */
  readonly content: string
  readonly embeds?: readonly DiscordEmbed[]
  readonly ephemeral: boolean
}

/** A person ran one of the bot's slash commands. */
export interface DiscordCommandInvocation {
  readonly name: string
  readonly userId: string
  /** `null` in a direct message. */
  readonly guildId: string | null
  readonly channelId: string
  /** The invoker's Discord language (e.g. "ja", "en-US"). */
  readonly locale: string
  /** Answer it, once, within Discord's three seconds. */
  respond(response: DiscordCommandResponse): Promise<void>
}

/** Who acted on one of the bot's messages, and where. */
export interface DiscordActor {
  readonly userId: string
  /** `null` in a direct message. */
  readonly guildId: string | null
  /** The actor's Discord language. */
  readonly locale: string
  readonly channelId: string
}

/** A person pressed a button or chose in a select menu of the bot's message. Answer it once, within three seconds. */
export interface DiscordComponentPress extends DiscordActor {
  readonly customId: string
  readonly messageId: string
  /** A select menu's chosen values; empty for a button. */
  readonly values: readonly string[]
  /** Replace the message the component sits on. */
  update(message: DiscordMessageEdit): Promise<void>
  reply(response: DiscordCommandResponse): Promise<void>
  showModal(modal: DiscordTextModal): Promise<void>
}

/** A person submitted a modal the bot showed from one of its messages. Answer it once, within three seconds. */
export interface DiscordModalSubmit extends DiscordActor {
  readonly customId: string
  /** The message whose component opened the modal. */
  readonly messageId: string | null
  /** The text input's value. */
  readonly value: string
  /** Replace the message whose component opened the modal; rejects without one. */
  update(message: DiscordMessageEdit): Promise<void>
  reply(response: DiscordCommandResponse): Promise<void>
}

/** Why a client stopped, and whether a new client could succeed later. */
export interface DiscordFailure {
  readonly retryable: boolean
  readonly reason: string
}

/** What a client reports, always after {@link OpenDiscordClient} returned it. */
export interface DiscordClientEvents {
  /** The Gateway started a new session (not a resume): whatever happened while none was open was not heard. */
  ready(account: DiscordAccount): void
  /** The Gateway resumed its session: nothing was lost. */
  resumed(): void
  /** The Gateway dropped and the client is connecting again on its own. */
  reconnecting(): void
  message(message: DiscordMessage): void
  command(invocation: DiscordCommandInvocation): void
  component(press: DiscordComponentPress): void
  modal(submit: DiscordModalSubmit): void
  /** The client stopped for good and is destroyed; no event follows. */
  failed(failure: DiscordFailure): void
}

/** A message the bot edits or removes is `missing` when Discord no longer has it, or no longer lets this bot reach it. */
export type DiscordEditOutcome = "edited" | "missing"
export type DiscordRemoveOutcome = "removed" | "missing"
/** `full`: the channel holds as many pins as Discord allows; `forbidden`: Discord does not let the bot pin there. */
export type DiscordPinOutcome = "pinned" | "missing" | "full" | "forbidden"

export interface DiscordActions {
  /** The DM channel with a user. */
  openDm(userId: string): Promise<string>
  /** Post a message; resolves with its id. */
  send(channelId: string, message: DiscordOutgoingMessage): Promise<string>
  edit(
    channelId: string,
    messageId: string,
    message: DiscordMessageEdit,
  ): Promise<DiscordEditOutcome>
  /** Delete a message the bot posted. */
  remove(channelId: string, messageId: string): Promise<DiscordRemoveOutcome>
  /** Pin a message (Discord tells the channel so, once). */
  pin(channelId: string, messageId: string): Promise<DiscordPinOutcome>
  react(channelId: string, messageId: string, emoji: string): Promise<void>
  /** Show "typing" in a channel for about ten seconds. */
  typing(channelId: string): Promise<void>
  /** Up to {@link MESSAGES_PAGE_LIMIT} messages of a channel posted after `after`, in no particular order. */
  messagesAfter(channelId: string, after: string): Promise<readonly DiscordMessage[]>
  /** Replace the bot's global slash commands, usable where the client's mode puts its home. */
  registerCommands(commands: readonly DiscordCommandSpec[]): Promise<void>
}

/** One logged-in bot user; its actions reject once it is destroyed. */
export interface DiscordClient extends DiscordActions {
  destroy(): Promise<void>
}

/**
 * Where the bot lives, as the Gateway serves it: `dm` (direct messages only,
 * no privileged intent) or `channel` (server text channels, with the
 * privileged Message Content and Server Members intents; no direct messages).
 */
export type DiscordGatewayMode = "dm" | "channel"

/** Log a bot in with its token; the client connects, and reconnects after drops, until it fails or is destroyed. */
export type OpenDiscordClient = (
  token: string,
  mode: DiscordGatewayMode,
  events: DiscordClientEvents,
) => DiscordClient

/** A Discord account as REST tells it. */
export interface DiscordUserInfo {
  readonly id: string
  readonly username: string
  /** Its server nickname where read as a member, else its global display name, else its username. */
  readonly displayName: string
  /** Its avatar (Discord's default one when it has none). */
  readonly avatarUrl: string
  readonly bot: boolean
}

/** The application the token belongs to. */
export interface DiscordApplicationInfo {
  readonly id: string
  /** The bot user. */
  readonly bot: DiscordUserInfo
  /** Who owns the application: its owner, or the members of its team, the team's owner first. */
  readonly owners: readonly DiscordUserInfo[]
  /** The privileged intents the Developer Portal turned on (limited ones count). */
  readonly intents: { readonly members: boolean; readonly messageContent: boolean }
}

export interface DiscordRoleInfo {
  readonly id: string
  readonly permissions: bigint
}

export interface DiscordGuildInfo {
  readonly id: string
  readonly name: string
  readonly iconUrl?: string
  readonly ownerId: string
  readonly roles: readonly DiscordRoleInfo[]
}

export interface DiscordOverwrite {
  readonly id: string
  readonly kind: "role" | "member"
  readonly allow: bigint
  readonly deny: bigint
}

export interface DiscordChannelInfo {
  readonly id: string
  readonly guildId: string
  readonly name: string
  /** A server text channel (not a voice channel, a category, a thread or a forum). */
  readonly text: boolean
  readonly overwrites: readonly DiscordOverwrite[]
}

export interface DiscordMemberInfo {
  readonly user: DiscordUserInfo
  readonly roles: readonly string[]
}

/** Why a REST read failed. */
export type DiscordLookupFailure =
  /** Discord rejected the token. */
  | "token-rejected"
  /** Listing a server's members needs the Server Members intent. */
  | "members-intent"
  /** Discord could not be reached, or answered with an error. */
  | "unreachable"

export class DiscordLookupError extends Error {
  override readonly name = "DiscordLookupError"
  constructor(
    readonly failure: DiscordLookupFailure,
    message: string,
  ) {
    super(message)
  }
}

/**
 * What the settings ask Discord with a token, over REST only (no Gateway
 * connection). Rejects with a {@link DiscordLookupError}.
 */
export interface DiscordLookup {
  application(signal: AbortSignal): Promise<DiscordApplicationInfo>
  /** The servers the bot is in. */
  guilds(signal: AbortSignal): Promise<readonly { readonly id: string; readonly name: string }[]>
  guild(guildId: string, signal: AbortSignal): Promise<DiscordGuildInfo | undefined>
  channels(guildId: string, signal: AbortSignal): Promise<readonly DiscordChannelInfo[]>
  member(
    guildId: string,
    userId: string,
    signal: AbortSignal,
  ): Promise<DiscordMemberInfo | undefined>
  /** Every member of the server, up to {@link MEMBERS_LIMIT}. */
  members(guildId: string, signal: AbortSignal): Promise<readonly DiscordMemberInfo[]>
  user(userId: string, signal: AbortSignal): Promise<DiscordUserInfo | undefined>
}

/** Upper bound of the members {@link DiscordLookup.members} reads from one server. */
export const MEMBERS_LIMIT = 5000

export type OpenDiscordLookup = (token: string) => DiscordLookup
