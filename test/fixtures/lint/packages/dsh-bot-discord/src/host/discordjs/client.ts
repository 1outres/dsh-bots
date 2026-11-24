// The discord.js adapter is the one place that imports the library, but not the Host's files.
import { writeFile } from "node:fs/promises" // rule: 35
import { Client } from "discord.js"

export const library = [Client, writeFile]
