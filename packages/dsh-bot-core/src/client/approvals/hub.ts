import { createFeedHub } from "../feed-hub"
import type { Observable } from "../observable"
import type { ActionsModel, ActionsState } from "./actions-model"

export interface ActionsFeed extends Observable<ActionsState>, Pick<ActionsModel, "decide"> {}

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
