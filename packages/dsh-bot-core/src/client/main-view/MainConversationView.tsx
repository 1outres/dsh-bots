import { createContext, useContext } from "react"
import { createPortal } from "react-dom"
import type { BotView } from "../../shared/bots"
import type { ConversationViewsProps } from "../dsh/conversation"
import { SLOT } from "../dsh/slots"
import { useObservable } from "../hooks"
import type { Translate } from "../types"
import type { MainViewFace } from "./face"
import { MainTimeline } from "./MainTimeline"

export interface MainViewScope {
  readonly t: Translate
  readonly bot: BotView
  readonly sessionId: string
  readonly face: MainViewFace
  openFile(path: string): void
}

export const MainViewContext = createContext<MainViewScope | undefined>(undefined)

export function MainConversationView(props: ConversationViewsProps) {
  const scope = useContext(MainViewContext)
  if (scope === undefined) throw new Error("bot-core: the Main view is drawn outside its scope")
  const seat = useObservable(scope.face.seats)[scope.sessionId]
  return (
    <>
      <MainTimeline
        t={scope.t}
        bot={scope.bot}
        feed={scope.face.timelines.feed(scope.bot.id)}
        images={scope.face.images}
        openFile={scope.openFile}
      />
      {seat !== undefined &&
        createPortal(props.renderSlot(SLOT.conversationSession, { view: "chat" }), seat)}
    </>
  )
}
