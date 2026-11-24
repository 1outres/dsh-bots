import { createFeedHub } from "../feed-hub"
import type { Observable } from "../observable"
import type { ActionsModel, ActionsState } from "./actions-model"

/** One bot's actions, streamed while anything subscribes; decisions go through the followed stream. */
export interface ActionsFeed extends Observable<ActionsState>, Pick<ActionsModel, "decide"> {}

/** Bots' connector actions shared by everything that shows them: one stream per bot. */
export interface ActionsHub {
  feed(botId: string): ActionsFeed
}

export function createActionsHub(open: (botId: string) => ActionsModel): ActionsHub {
  return createFeedHub<ActionsState, ActionsModel, Pick<ActionsFeed, "decide">>({
    name: "connector actions",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      decide: async (actionId, decision) => followed().decide(actionId, decision),
    }),
  })
}
