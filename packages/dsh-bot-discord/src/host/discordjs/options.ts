import { type ClientOptions, GatewayIntentBits, Partials } from "discord.js"
import type { DiscordGatewayMode } from "../discord"
import { stoppableSharding } from "./sharding"

/** The Gateway intents of each mode: DMs need no privileged one; a server channel needs Message Content and Server Members. */
export const MODE_INTENTS: Readonly<Record<DiscordGatewayMode, readonly GatewayIntentBits[]>> = {
  dm: [GatewayIntentBits.DirectMessages],
  channel: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
}

/**
 * DM channels are not cached before their first message, so in DM mode they
 * arrive as partials. Mentions in anything the bot posts never ping. The
 * Gateway opens no connection once `stopped()`.
 */
export function clientOptions(mode: DiscordGatewayMode, stopped: () => boolean): ClientOptions {
  return {
    intents: [...MODE_INTENTS[mode]],
    partials: mode === "dm" ? [Partials.Channel] : [],
    allowedMentions: { parse: [] },
    ws: { buildStrategy: (manager) => stoppableSharding(manager, stopped) },
  }
}
