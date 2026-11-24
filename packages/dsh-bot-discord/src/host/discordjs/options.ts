import { type ClientOptions, GatewayIntentBits, Partials } from "discord.js"
import { stoppableSharding } from "./sharding"

/**
 * Direct messages only: DM channels are not cached before their first
 * message, so they arrive as partials. A DM's content needs no privileged
 * intent. Mentions in anything the bot posts never ping. The Gateway opens
 * no connection once `stopped()`.
 */
export function clientOptions(stopped: () => boolean): ClientOptions {
  return {
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
    ws: { buildStrategy: (manager) => stoppableSharding(manager, stopped) },
  }
}
