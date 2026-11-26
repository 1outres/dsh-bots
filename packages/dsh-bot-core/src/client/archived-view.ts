import { type BotFlagStore, createBotFlagStore } from "./bot-flags"

export type ArchivedViewStore = BotFlagStore

export const createArchivedViewStore = (): ArchivedViewStore =>
  createBotFlagStore("dsh-bots:archived-shown")
