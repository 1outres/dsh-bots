import type { BotFilesClient } from "../files"
import type { Observable } from "../observable"
import type { Viewer } from "../viewer"
import type { PanelWidth } from "./panel-width"
import { createPreviewModel, type PreviewModel } from "./preview-model"
import { createSearchModel, type SearchModel, type Timers } from "./search-model"
import { createTreeModel, type TreeModel } from "./tree-model"

/** What the file panel reads and drives. */
export interface FilesFace {
  readonly viewer: Viewer
  readonly width: PanelWidth
  /** False while file links cannot reach the viewer (DSH's sidebar store is not borrowed). */
  readonly linksAvailable: Observable<boolean>
  treeOf(sessionId: string): TreeModel
  searchOf(sessionId: string): SearchModel
  previewOf(sessionId: string): PreviewModel
}

/** Each bot session's file models, kept while the page lives so closing the panel keeps them. */
export interface SessionModels extends Pick<FilesFace, "treeOf" | "searchOf" | "previewOf"> {
  /** Release the models of every session `keep` refuses. */
  forget(keep: (sessionId: string) => boolean): void
  dispose(): void
}

interface Models {
  readonly tree: TreeModel
  readonly search: SearchModel
  readonly preview: PreviewModel
}

export function createSessionModels(files: BotFilesClient, timers: Timers): SessionModels {
  const sessions = new Map<string, Models>()
  const of = (sessionId: string): Models => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created: Models = {
      tree: createTreeModel(files, sessionId),
      search: createSearchModel(files, sessionId, timers),
      preview: createPreviewModel(files, sessionId),
    }
    sessions.set(sessionId, created)
    return created
  }
  const release = (models: Models) => {
    models.tree.dispose()
    models.search.cancel()
    models.preview.cancel()
  }
  return {
    treeOf: (sessionId) => of(sessionId).tree,
    searchOf: (sessionId) => of(sessionId).search,
    previewOf: (sessionId) => of(sessionId).preview,
    forget(keep) {
      for (const [sessionId, models] of sessions) {
        if (keep(sessionId)) continue
        release(models)
        sessions.delete(sessionId)
      }
    },
    dispose() {
      for (const models of sessions.values()) release(models)
      sessions.clear()
    },
  }
}
