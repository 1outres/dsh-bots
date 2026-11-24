import { type BotFlagStore, createBotFlagStore } from "./bot-flags"

/** Which bots list their archived sessions among the others, as Workspaces' "show archived". */
export type ArchivedViewStore = BotFlagStore

export const createArchivedViewStore = (): ArchivedViewStore =>
  createBotFlagStore("dsh-bots:archived-shown")
