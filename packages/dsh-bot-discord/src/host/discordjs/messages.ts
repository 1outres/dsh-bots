import {
  type AttachmentPayload,
  type GatewayReadyDispatchData,
  type Message,
  type MessageCreateOptions,
  MessageType,
} from "discord.js"
import type {
  DiscordAccount,
  DiscordMessage,
  DiscordMessageKind,
  DiscordOutgoingMessage,
} from "../discord"
import { toActionRows, toEmbeds } from "./components"

function kindOf(type: MessageType): DiscordMessageKind {
  switch (type) {
    case MessageType.Default:
      return "default"
    case MessageType.Reply:
      return "reply"
    default:
      return "other"
  }
}

export function toDiscordMessage(message: Message): DiscordMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    server:
      message.guild === null || !("name" in message.channel) || message.channel.name === null
        ? null
        : { name: message.guild.name, channel: message.channel.name },
    kind: kindOf(message.type),
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.displayName,
      bot: message.author.bot,
    },
    content: message.content,
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
      contentType: attachment.contentType,
    })),
    createdAt: message.createdTimestamp,
  }
}

/** discord.js's options for a message the bot posts. */
export function toMessageOptions(message: DiscordOutgoingMessage): MessageCreateOptions {
  const files = (message.files ?? []).map(
    (file): AttachmentPayload => ({
      attachment: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength),
      name: file.name,
    }),
  )
  return {
    ...(message.content === "" ? {} : { content: message.content }),
    ...(files.length === 0 ? {} : { files }),
    ...(message.embeds === undefined ? {} : { embeds: toEmbeds(message.embeds) }),
    ...(message.components === undefined ? {} : { components: toActionRows(message.components) }),
    ...(message.replyTo === undefined
      ? {}
      : { reply: { messageReference: message.replyTo, failIfNotExists: false } }),
  }
}

export function toDiscordAccount(user: GatewayReadyDispatchData["user"]): DiscordAccount {
  return {
    id: user.id,
    tag: user.discriminator === "0" ? user.username : `${user.username}#${user.discriminator}`,
  }
}
