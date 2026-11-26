import { type BotFlagStore, type BotFlags, createBotFlagStore, parseBotFlags } from "./bot-flags"

export type Expansion = BotFlags

export type ExpansionStore = BotFlagStore

export const parseExpansion = parseBotFlags

export const createExpansionStore = (): ExpansionStore => createBotFlagStore("dsh-bots:expanded")
