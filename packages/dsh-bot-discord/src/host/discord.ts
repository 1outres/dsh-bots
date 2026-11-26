export const MESSAGES_PAGE_LIMIT = 100

export interface DiscordAccount {
  readonly id: string
  readonly tag: string
}

export type DiscordMessageKind = "default" | "reply" | "other"

export interface DiscordAuthor {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly bot: boolean
}

export interface DiscordAttachment {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly contentType: string | null
}

export interface DiscordMessage {
  readonly id: string
  readonly channelId: string
  readonly guildId: string | null
  readonly server: { readonly name: string; readonly channel: string } | null
  readonly kind: DiscordMessageKind
  readonly author: DiscordAuthor
  readonly content: string
  readonly attachments: readonly DiscordAttachment[]
  readonly createdAt: number
}

export interface DiscordFile {
  readonly name: string
  readonly data: Uint8Array
}

export type DiscordButtonStyle = "primary" | "secondary" | "success" | "danger"

export interface DiscordButton {
  readonly kind: "button"
  readonly customId: string
  readonly label: string
  readonly style: DiscordButtonStyle
  readonly disabled: boolean
}

export interface DiscordSelectOption {
  readonly value: string
  readonly label: string
  readonly description?: string
  readonly selected: boolean
}

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

export type DiscordComponentRow = readonly DiscordComponent[]

export const CUSTOM_ID_LIMIT = 100
export const ROW_BUTTON_LIMIT = 5
export const MESSAGE_ROW_LIMIT = 5
export const SELECT_OPTION_LIMIT = 25

export interface DiscordEmbed {
  readonly title?: string
  readonly description?: string
}

export interface DiscordOutgoingMessage {
  readonly content: string
  readonly files?: readonly DiscordFile[]
  readonly embeds?: readonly DiscordEmbed[]
  readonly components?: readonly DiscordComponentRow[]
  readonly replyTo?: string
}

export interface DiscordMessageEdit {
  readonly content: string
  readonly embeds?: readonly DiscordEmbed[]
  readonly components: readonly DiscordComponentRow[]
}

export interface DiscordTextModal {
  readonly customId: string
  readonly title: string
  readonly input: {
    readonly label: string
    readonly required: boolean
    readonly maxLength: number
    readonly value?: string
    readonly placeholder?: string
  }
}

export interface DiscordCommandSpec {
  readonly name: string
  readonly description: string
  readonly descriptionJa?: string
}

export interface DiscordCommandResponse {
  readonly content: string
  readonly embeds?: readonly DiscordEmbed[]
  readonly ephemeral: boolean
}

export interface DiscordCommandInvocation {
  readonly name: string
  readonly userId: string
  readonly guildId: string | null
  readonly channelId: string
  readonly locale: string
  respond(response: DiscordCommandResponse): Promise<void>
}

export interface DiscordActor {
  readonly userId: string
  readonly guildId: string | null
  readonly locale: string
  readonly channelId: string
}

export interface DiscordComponentPress extends DiscordActor {
  readonly customId: string
  readonly messageId: string
  readonly values: readonly string[]
  update(message: DiscordMessageEdit): Promise<void>
  reply(response: DiscordCommandResponse): Promise<void>
  showModal(modal: DiscordTextModal): Promise<void>
}

export interface DiscordModalSubmit extends DiscordActor {
  readonly customId: string
  readonly messageId: string | null
  readonly value: string
  update(message: DiscordMessageEdit): Promise<void>
  reply(response: DiscordCommandResponse): Promise<void>
}

export interface DiscordFailure {
  readonly retryable: boolean
  readonly reason: string
}

export interface DiscordClientEvents {
  ready(account: DiscordAccount): void
  resumed(): void
  reconnecting(): void
  message(message: DiscordMessage): void
  command(invocation: DiscordCommandInvocation): void
  component(press: DiscordComponentPress): void
  modal(submit: DiscordModalSubmit): void
  failed(failure: DiscordFailure): void
}

export type DiscordEditOutcome = "edited" | "missing"
export type DiscordRemoveOutcome = "removed" | "missing"
export type DiscordPinOutcome = "pinned" | "missing" | "full" | "forbidden"

export interface DiscordActions {
  openDm(userId: string): Promise<string>
  send(channelId: string, message: DiscordOutgoingMessage): Promise<string>
  edit(
    channelId: string,
    messageId: string,
    message: DiscordMessageEdit,
  ): Promise<DiscordEditOutcome>
  remove(channelId: string, messageId: string): Promise<DiscordRemoveOutcome>
  pin(channelId: string, messageId: string): Promise<DiscordPinOutcome>
  react(channelId: string, messageId: string, emoji: string): Promise<void>
  typing(channelId: string): Promise<void>
  messagesAfter(channelId: string, after: string): Promise<readonly DiscordMessage[]>
  registerCommands(commands: readonly DiscordCommandSpec[]): Promise<void>
}

export interface DiscordClient extends DiscordActions {
  destroy(): Promise<void>
}

export type DiscordGatewayMode = "dm" | "channel"

export type OpenDiscordClient = (
  token: string,
  mode: DiscordGatewayMode,
  events: DiscordClientEvents,
) => DiscordClient

export interface DiscordUserInfo {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly avatarUrl: string
  readonly bot: boolean
}

export interface DiscordApplicationInfo {
  readonly id: string
  readonly bot: DiscordUserInfo
  readonly owners: readonly DiscordUserInfo[]
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
  readonly text: boolean
  readonly overwrites: readonly DiscordOverwrite[]
}

export interface DiscordMemberInfo {
  readonly user: DiscordUserInfo
  readonly roles: readonly string[]
}

export type DiscordLookupFailure = "token-rejected" | "members-intent" | "unreachable"

export class DiscordLookupError extends Error {
  override readonly name = "DiscordLookupError"
  constructor(
    readonly failure: DiscordLookupFailure,
    message: string,
  ) {
    super(message)
  }
}

export interface DiscordLookup {
  application(signal: AbortSignal): Promise<DiscordApplicationInfo>
  guilds(signal: AbortSignal): Promise<readonly { readonly id: string; readonly name: string }[]>
  guild(guildId: string, signal: AbortSignal): Promise<DiscordGuildInfo | undefined>
  channels(guildId: string, signal: AbortSignal): Promise<readonly DiscordChannelInfo[]>
  member(
    guildId: string,
    userId: string,
    signal: AbortSignal,
  ): Promise<DiscordMemberInfo | undefined>
  members(guildId: string, signal: AbortSignal): Promise<readonly DiscordMemberInfo[]>
  user(userId: string, signal: AbortSignal): Promise<DiscordUserInfo | undefined>
}

export const MEMBERS_LIMIT = 5000

export type OpenDiscordLookup = (token: string) => DiscordLookup
