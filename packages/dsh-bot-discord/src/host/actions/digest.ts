import type { ConnectorActionView } from "@1outres/dsh-bot-core"
import type { DiscordEmbed, DiscordMessageEdit } from "../discord"
import { clip } from "../interactions/render"
import type { DiscordLocale } from "../texts"
import { literal } from "./render"
import { actionText } from "./texts"

const TITLE_LIMIT = 256
const DESCRIPTION_LIMIT = 4096
/** Longest action title in a line of the list. */
export const LINE_TITLE_LIMIT = 100

/** Where a message sits: its server (`null` for a DM), channel and message. */
export interface MessageLocation {
  readonly guildId: string | null
  readonly channelId: string
  readonly messageId: string
}

/** A pending action in the list, with its card at the home when there is one. */
export interface DigestEntry {
  readonly action: ConnectorActionView
  readonly card: MessageLocation | undefined
}

export function messageUrl(location: MessageLocation): string {
  return `https://discord.com/channels/${location.guildId ?? "@me"}/${location.channelId}/${location.messageId}`
}

function lineOf(entry: DigestEntry, index: number, locale: DiscordLocale): string {
  const { action, card } = entry
  const title = literal(clip(action.preview.title, LINE_TITLE_LIMIT))
  const named = card === undefined ? `**${title}**` : `[${title}](${messageUrl(card)})`
  const where = `${literal(action.connector.name ?? action.connector.id)} · \`${action.toolName}\``
  const expires = actionText("digestExpires", locale, {
    expires: `<t:${Math.floor(action.expiresAt / 1000)}:R>`,
  })
  return `${index + 1}. ${named} — ${where} · ${expires}`
}

/**
 * The list of a bot's pending actions, one line each in the order given
 * (oldest first): its title linking to its card, the connector and tool, and
 * when it expires. Lines past the embed's limit become one "and N more".
 */
export function digestEmbed(
  bot: string,
  entries: readonly DigestEntry[],
  locale: DiscordLocale,
): DiscordEmbed {
  const title = clip(actionText("digestTitle", locale, { bot, count: entries.length }), TITLE_LIMIT)
  if (entries.length === 0) {
    return { title, description: actionText("digestEmpty", locale) }
  }
  const hint = `-# ${actionText("digestHint", locale)}`
  const more = (count: number) => actionText("digestMore", locale, { count })
  const reserve = hint.length + more(entries.length).length + 2
  const lines: string[] = []
  let used = 0
  for (const [index, entry] of entries.entries()) {
    const line = lineOf(entry, index, locale)
    if (used + line.length + 1 + reserve > DESCRIPTION_LIMIT) break
    lines.push(line)
    used += line.length + 1
  }
  const hidden = entries.length - lines.length
  const body = hidden === 0 ? lines : [...lines, more(hidden)]
  return { title, description: [...body, hint].join("\n") }
}

/** The pending approvals list as the message pinned at the home. */
export function renderDigest(
  bot: string,
  entries: readonly DigestEntry[],
  locale: DiscordLocale,
): DiscordMessageEdit {
  return { content: "", embeds: [digestEmbed(bot, entries, locale)], components: [] }
}
