import { type ClientOptions, GatewayIntentBits, Partials } from "discord.js"
import type { DiscordGatewayMode } from "../discord"
import { stoppableSharding } from "./sharding"

export const MODE_INTENTS: Readonly<Record<DiscordGatewayMode, readonly GatewayIntentBits[]>> = {
  dm: [GatewayIntentBits.DirectMessages],
  channel: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
}

export function clientOptions(mode: DiscordGatewayMode, stopped: () => boolean): ClientOptions {
  return {
    intents: [...MODE_INTENTS[mode]],
    partials: mode === "dm" ? [Partials.Channel] : [],
    allowedMentions: { parse: [] },
    ws: { buildStrategy: (manager) => stoppableSharding(manager, stopped) },
  }
}
