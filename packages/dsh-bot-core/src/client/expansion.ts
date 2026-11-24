import { type BotFlagStore, type BotFlags, createBotFlagStore, parseBotFlags } from "./bot-flags"

export type Expansion = BotFlags

/** Each bot's pinned expansion; a bot without an entry follows the selection. */
export type ExpansionStore = BotFlagStore

export const parseExpansion = parseBotFlags

/** Expansion shared by the rows, the keyboard and the row menu; persisted in localStorage. */
export const createExpansionStore = (): ExpansionStore => createBotFlagStore("dsh-bots:expanded")
