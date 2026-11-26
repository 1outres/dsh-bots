import type { PanelWidth } from "../files/panel-width"
import type { Timers } from "../files/search-model"
import type { NotesClient } from "./client"
import { createNotesModel, type NotesModel } from "./model"

export interface NotesFace {
  readonly width: PanelWidth
  modelOf(sessionId: string): NotesModel
}

export interface NotesModels {
  modelOf(sessionId: string): NotesModel
  forget(keep: (sessionId: string) => boolean): void
  dispose(): void
}

export function createNotesModels(client: NotesClient, timers: Timers): NotesModels {
  const sessions = new Map<string, NotesModel>()
  return {
    modelOf(sessionId) {
      const known = sessions.get(sessionId)
      if (known !== undefined) return known
      const created = createNotesModel(client, sessionId, timers)
      sessions.set(sessionId, created)
      return created
    },
    forget(keep) {
      for (const [sessionId, model] of sessions) {
        if (keep(sessionId)) continue
        model.dispose()
        sessions.delete(sessionId)
      }
    },
    dispose() {
      for (const model of sessions.values()) model.dispose()
      sessions.clear()
    },
  }
}
