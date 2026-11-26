import { REST } from "@discordjs/rest"
import type { APIMessage } from "discord-api-types/v10"
import { Client } from "discord.js"

export const values: [unknown, unknown, APIMessage | undefined] = [Client, REST, undefined]
