import { createBotFilesClient } from "../files"
import { createSessionModels, type FilesFace } from "../files/files-face"
import { createPanelWidth, FILES_PANEL_WIDTH } from "../files/panel-width"
import { BROWSER_TIMERS } from "../files/search-model"
import type { Observable } from "../observable"
import type { RemoteMount } from "../remote"
import type { BotsState, SessionClassifier } from "../session-classification"
import type { ClientContext } from "../types"
import { createViewer } from "../viewer"

export interface FilesSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly classify: SessionClassifier["classify"]
  /** Whether file links reach the viewer (the right sidebar lockdown's status). */
  readonly linksAvailable: Observable<boolean>
}

/** The bot file viewer: its state per session and the models reading through `remote.botFiles`. */
export function wireFiles(ctx: ClientContext, sources: FilesSources): FilesFace {
  const viewer = createViewer()
  const models = createSessionModels(createBotFilesClient(sources.remote), BROWSER_TIMERS)
  ctx.effect(() => () => models.dispose(), "bot-core: file models")

  const isBotSession = (sessionId: string) => sources.classify(sessionId).kind === "bot"
  // A deleted bot's sessions drop out once a delivered list says so.
  ctx.effect(
    () =>
      sources.bots.subscribe(() => {
        if (sources.bots.getSnapshot().status !== "ready") return
        viewer.forget(isBotSession)
        models.forget(isBotSession)
      }),
    "bot-core: release the viewers of removed bot sessions",
  )

  return {
    viewer,
    width: createPanelWidth(FILES_PANEL_WIDTH),
    linksAvailable: sources.linksAvailable,
    treeOf: models.treeOf,
    searchOf: models.searchOf,
    previewOf: models.previewOf,
  }
}
