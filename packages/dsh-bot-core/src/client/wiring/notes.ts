import { createPanelWidth, NOTES_PANEL_WIDTH } from "../files/panel-width"
import { BROWSER_TIMERS } from "../files/search-model"
import { createNotesClient } from "../notes/client"
import { createNotesModels, type NotesFace } from "../notes/face"
import type { Observable } from "../observable"
import type { RemoteMount } from "../remote"
import type { BotsState, SessionClassifier } from "../session-classification"
import type { ClientContext } from "../types"

export interface NotesSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly classify: SessionClassifier["classify"]
}

export function wireNotes(ctx: ClientContext, sources: NotesSources): NotesFace {
  const models = createNotesModels(createNotesClient(sources.remote), BROWSER_TIMERS)
  ctx.effect(() => () => models.dispose(), "bot-core: notes models")
  ctx.effect(
    () =>
      sources.bots.subscribe(() => {
        if (sources.bots.getSnapshot().status !== "ready") return
        models.forget((sessionId) => sources.classify(sessionId).kind === "bot")
      }),
    "bot-core: release the notes of removed bot sessions",
  )
  return { width: createPanelWidth(NOTES_PANEL_WIDTH), modelOf: models.modelOf }
}
