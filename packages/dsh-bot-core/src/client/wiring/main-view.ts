import { createPanelWidth, SESSION_LOG_PANEL_WIDTH } from "../files/panel-width"
import type { MainBinding } from "../main-session"
import { createMainViewClient } from "../main-view/client"
import type { MainViewFace } from "../main-view/face"
import { createTimelineImages } from "../main-view/images"
import { createTimelinesHub } from "../main-view/model"
import { createSessionLogSeats } from "../main-view/seats"
import type { Observable } from "../observable"
import type { RemoteMount } from "../remote"
import { type BotsState, snapshotOf } from "../session-classification"
import type { ClientContext } from "../types"

export interface MainViewSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly binding: Observable<MainBinding>
}

/**
 * The Main view of the bot sessions: each bot's timeline over its Mains, the
 * Session log panel's seat, and the main view following a bot to its new Main
 * when it showed the one that was replaced.
 */
export function wireMainView(ctx: ClientContext, sources: MainViewSources): MainViewFace {
  const client = createMainViewClient(sources.remote, ctx.connection.generation)
  const images = createTimelineImages(client)
  ctx.effect(() => () => images.dispose(), "bot-core: Main view images")
  ctx.effect(() => {
    let mains = new Map<string, string>()
    const record = () => {
      const snapshot = snapshotOf(sources.bots.getSnapshot())
      if (snapshot === undefined) return
      const next = new Map(snapshot.bots.map((bot) => [bot.id, bot.mainSessionId]))
      const binding = sources.binding.getSnapshot()
      for (const [botId, mainSessionId] of next) {
        const previous = mains.get(botId)
        if (
          previous !== undefined &&
          previous !== mainSessionId &&
          binding.kind === "session" &&
          binding.sessionId === previous
        ) {
          ctx.uiWorkspace.openSession(mainSessionId)
        }
      }
      mains = next
    }
    record()
    return sources.bots.subscribe(record)
  }, "bot-core: follow a bot to its new Main")
  return {
    timelines: createTimelinesHub(client),
    images,
    seats: createSessionLogSeats(),
    width: createPanelWidth(SESSION_LOG_PANEL_WIDTH),
  }
}
