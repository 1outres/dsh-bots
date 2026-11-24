import type { Observable } from "../observable"
import type { BotsState, SessionClassifier } from "../session-classification"
import { createSidePanels, type SidePanels } from "../shell/side-panels"
import type { ClientContext } from "../types"
import type { Viewer } from "../viewer"

export interface SidePanelsSources {
  readonly bots: Observable<BotsState>
  readonly classify: SessionClassifier["classify"]
  readonly viewer: Viewer
}

/** The Actions and connector panels of the bot sessions, released with the sessions a bots list no longer names. */
export function wireSidePanels(ctx: ClientContext, sources: SidePanelsSources): SidePanels {
  const panels = createSidePanels(sources.viewer)
  ctx.effect(() => () => panels.dispose(), "bot-core: side panels")
  ctx.effect(
    () =>
      sources.bots.subscribe(() => {
        if (sources.bots.getSnapshot().status !== "ready") return
        panels.forget((sessionId) => sources.classify(sessionId).kind === "bot")
      }),
    "bot-core: release the side panels of removed bot sessions",
  )
  return panels
}
