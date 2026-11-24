import type { Timers } from "../../src/client/files/search-model"
import type { NotesClient } from "../../src/client/notes/client"
import { createNotesModels, type NotesFace } from "../../src/client/notes/face"
import { value } from "./client"

/** Timers the test runs by hand. */
export function manualTimers(): Timers & { run(): void } {
  const pending = new Map<number, () => void>()
  let next = 0
  return {
    set(run) {
      next += 1
      pending.set(next, run)
      return next
    },
    clear: (handle) => pending.delete(handle as number),
    run() {
      const runs = [...pending.values()]
      pending.clear()
      for (const run of runs) run()
    },
  }
}

/** A notes client that never answers: the panel stays loading. */
export const idleNotesClient: NotesClient = {
  status: () => value({ status: "loading" }),
  list: () => new Promise(() => {}),
  search: () => new Promise(() => {}),
  read: () => new Promise(() => {}),
  month: () => new Promise(() => {}),
}

export function notesFace(client: NotesClient = idleNotesClient): NotesFace {
  const models = createNotesModels(client, manualTimers())
  return { width: { ...value(480), resize: () => {} }, modelOf: models.modelOf }
}
