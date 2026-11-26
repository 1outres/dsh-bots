import type { DiscordActions } from "./discord"
import type { DiscordHome } from "./home"

export interface HomeChannel {
  readonly channelId: string
  readonly guildId: string | null
}

export interface HomeTarget {
  channel(): Promise<HomeChannel>
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
