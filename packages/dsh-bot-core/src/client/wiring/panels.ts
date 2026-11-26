import type { Observable } from "../observable"
import type { BotsState, SessionClassifier } from "../session-classification"
import { createShellPopovers, type ShellPopovers } from "../shell/popovers"
import { createSidePanels, type SidePanels } from "../shell/side-panels"
import type { ClientContext } from "../types"
import type { Viewer } from "../viewer"

export interface PanelsSources {
  readonly bots: Observable<BotsState>
  readonly classify: SessionClassifier["classify"]
  readonly viewer: Viewer
}

export interface ShellPanels {
  readonly panels: SidePanels
  readonly popovers: ShellPopovers
}

export function wirePanels(ctx: ClientContext, sources: PanelsSources): ShellPanels {
  const panels = createSidePanels(sources.viewer)
  const popovers = createShellPopovers({ panels, viewer: sources.viewer })
  ctx.effect(
    () => () => {
      popovers.dispose()
      panels.dispose()
    },
    "bot-core: side panels and popovers",
  )
  ctx.effect(
    () =>
      sources.bots.subscribe(() => {
        if (sources.bots.getSnapshot().status !== "ready") return
        const keep = (sessionId: string) => sources.classify(sessionId).kind === "bot"
        panels.forget(keep)
        popovers.forget(keep)
      }),
    "bot-core: release the panels of removed bot sessions",
  )
  return { panels, popovers }
}
