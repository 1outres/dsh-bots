import type { DiscordActions } from "./discord"
import type { DiscordHome } from "./home"

/** The Discord channel of the home: the home channel, or the DM channel with the owner. */
export interface HomeChannel {
  readonly channelId: string
  /** `null` for a DM. */
  readonly guildId: string | null
}

/** Where everything the bot posts goes. */
export interface HomeTarget {
  /** The home's channel; a DM is opened once. Rejects when it cannot be opened. */
  channel(): Promise<HomeChannel>
  /** The DM channel the owner wrote from. */
  learn(channelId: string): void
}

export function createHomeTarget(home: DiscordHome, openDm: DiscordActions["openDm"]): HomeTarget {
  if (home.kind === "channel") {
    const channel: HomeChannel = { channelId: home.channelId, guildId: home.guildId }
    return { channel: async () => channel, learn: () => {} }
  }
  let known: HomeChannel | undefined
  return {
    async channel() {
      known ??= { channelId: await openDm(home.owner), guildId: null }
      return known
    },
    learn(channelId) {
      known = { channelId, guildId: null }
    },
  }
}
