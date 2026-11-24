import type { BotChannelDescriptor } from "../../shared/channels"

/** The channel's ids of the bot's owners there, as its settings list them; none when it names no owners field. */
export function ownersOf(
  channel: Pick<BotChannelDescriptor, "owners">,
  settings: Readonly<Record<string, string | readonly string[]>>,
): ReadonlySet<string> {
  const value = channel.owners === undefined ? undefined : settings[channel.owners]
  return new Set(Array.isArray(value) ? value : [])
}
