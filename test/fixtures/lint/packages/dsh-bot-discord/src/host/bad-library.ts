import { REST } from "@discordjs/rest" // rule: 33
import type { APIMessage } from "discord-api-types/v10" // rule: 33
import { Client } from "discord.js" // rule: 33

export const values: [unknown, unknown, APIMessage | undefined] = [Client, REST, undefined]
