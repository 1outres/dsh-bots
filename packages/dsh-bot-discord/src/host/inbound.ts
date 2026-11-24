import type { BotInboundMessage } from "@1outres/dsh-bot-core"
import type { DiscordMessage, DiscordMessageKind } from "./discord"
import { downloadAttachment, type FetchUrl } from "./download"

const CONVERSATION_KINDS: ReadonlySet<DiscordMessageKind> = new Set(["default", "reply"])

/** Whether a message is one an allowed person wrote to the bot in a DM. */
export function isAllowedDirectMessage(
  message: DiscordMessage,
  allowed: ReadonlySet<string>,
  self: string | undefined,
): boolean {
  return (
    message.guildId === null &&
    CONVERSATION_KINDS.has(message.kind) &&
    !message.author.bot &&
    message.author.id !== self &&
    allowed.has(message.author.id)
  )
}

/**
 * What a direct message brings the bot: who wrote it, its text and
 * attachments, each read from Discord's CDN once bot-core accepts it.
 */
export function inboundMessageOf(message: DiscordMessage, fetch: FetchUrl): BotInboundMessage {
  return {
    place: { kind: "direct" },
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

/** Whether a message brings anything (stickers and embeds alone do not count). */
export function hasContent(message: DiscordMessage): boolean {
  return message.content.trim().length > 0 || message.attachments.length > 0
}
