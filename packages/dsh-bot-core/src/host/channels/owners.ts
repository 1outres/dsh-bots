import type { BotChannelDescriptor } from "../../shared/channels"

export function ownersOf(
  channel: Pick<BotChannelDescriptor, "owners">,
  settings: Readonly<Record<string, string | readonly string[]>>,
): ReadonlySet<string> {
  const value = channel.owners === undefined ? undefined : settings[channel.owners]
  return new Set(Array.isArray(value) ? value : [])
}
