import type { BotInboundMessage } from "@1outres/dsh-bot-core"
import type { DiscordMessage, DiscordMessageKind } from "./discord"
import { downloadAttachment, type FetchUrl } from "./download"
import { atHome, type DiscordHome } from "./home"

const CONVERSATION_KINDS: ReadonlySet<DiscordMessageKind> = new Set(["default", "reply"])

export function isHomeMessage(
  message: DiscordMessage,
  home: DiscordHome,
  self: string | undefined,
): boolean {
  return (
    CONVERSATION_KINDS.has(message.kind) &&
    !message.author.bot &&
    message.author.id !== self &&
    atHome(home, {
      userId: message.author.id,
      guildId: message.guildId,
      channelId: message.channelId,
    })
  )
}

export function inboundMessageOf(message: DiscordMessage, fetch: FetchUrl): BotInboundMessage {
  return {
    place:
      message.server === null
        ? { kind: "direct" }
        : { kind: "channel", channel: message.server.channel, server: message.server.name },
    sender: {
      id: message.author.id,
      displayName: message.author.displayName,
      handle: message.author.username,
      bot: message.author.bot,
    },
    sentAt: message.createdAt,
    text: message.content,
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      ...(attachment.contentType === null ? {} : { mediaType: attachment.contentType }),
      bytes: attachment.size,
      read: (maxBytes, signal) => downloadAttachment(fetch, attachment.url, maxBytes, signal),
    })),
  }
}

export function hasContent(message: DiscordMessage): boolean {
  return message.content.trim().length > 0 || message.attachments.length > 0
}
