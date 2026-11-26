import type { BotChannelConnectionState, BotChannelPerson } from "@1outres/dsh-bot-core"
import type { DiscordLookup } from "./discord"
import type { DiscordHome } from "./home"

/** The owners by the names they go by at the home: their server nickname in channel mode. */
export async function ownerNames(
  lookup: DiscordLookup,
  home: DiscordHome,
  owners: readonly string[],
  signal: AbortSignal,
): Promise<Readonly<Record<string, BotChannelPerson>>> {
  const people: Record<string, BotChannelPerson> = {}
  for (const id of owners) {
    const user =
      home.kind === "channel"
        ? (await lookup.member(home.guildId, id, signal))?.user
        : await lookup.user(id, signal)
    if (user !== undefined) people[id] = { displayName: user.displayName, handle: user.username }
  }
  return people
}

/**
 * The connection's state as reported, with the owners' names once they are
 * known: a connected state reported before them is reported again with them.
 */
export function createPresence(report: (state: BotChannelConnectionState) => void) {
  let state: BotChannelConnectionState = { state: "connecting" }
  let people: Readonly<Record<string, BotChannelPerson>> | undefined
  const send = () =>
    report(state.state === "connected" && people !== undefined ? { ...state, people } : state)
  return {
    report(next: BotChannelConnectionState) {
      state = next
      send()
    },
    named(next: Readonly<Record<string, BotChannelPerson>>) {
      people = next
      if (state.state === "connected") send()
    },
  }
}
