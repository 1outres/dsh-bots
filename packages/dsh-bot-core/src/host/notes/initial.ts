import type { InitialNotesVersion } from "../domain"
import type { Note } from "./note"
import type { NotesPlace } from "./notebook"
import type { BotNotesState } from "./tools"

export const OWNER_NOTE: Note = {
  title: "Owner",
  type: "person",
  aliases: [],
  summary: "My owner: who they are and how they like to be treated.",
  pinned: true,
  body: [
    "- Name: not known yet (rename this note to it once I know)",
    "- What to call them: not known yet",
    "- Work and daily life: not known yet",
    "- How they like to be contacted: not known yet",
  ].join("\n"),
}

export const NOW_NOTE: Note = {
  title: "Now",
  type: "topic",
  aliases: [],
  summary: "What is going on now: open matters, what is coming up, and what I promised.",
  pinned: true,
  body: [
    "- Open matters: none yet",
    "- Coming up: nothing yet",
    "- Promises I am keeping: none yet",
  ].join("\n"),
}

export const INITIAL_NOTES: readonly Note[] = [OWNER_NOTE, NOW_NOTE]

export interface InitialNotesDeps {
  placeOf(botId: string): NotesPlace | undefined
  withNotes<T>(botId: string, work: (state: BotNotesState) => Promise<T>): Promise<T>
  newId(): string
  readonly version: InitialNotesVersion
  placed(botId: string, version: InitialNotesVersion): boolean
  mark(botId: string, version: InitialNotesVersion): Promise<void>
}

export interface InitialNotes {
  ensure(botId: string, signal: AbortSignal): Promise<void>
}

export function createInitialNotes(deps: InitialNotesDeps): InitialNotes {
  const running = new Map<string, Promise<void>>()

  const place = async (botId: string, signal: AbortSignal) => {
    const place = deps.placeOf(botId)
    if (place === undefined) throw new Error(`the environment of bot "${botId}" is not available`)
    await deps.withNotes(botId, async (state) => {
      let view = await state.notebook.load(place, signal)
      for (const note of INITIAL_NOTES) {
        if (view.catalog.titled(note.title) !== undefined) continue
        view = await state.notebook.write(place, deps.newId(), note, "create", signal)
      }
    })
    await deps.mark(botId, deps.version)
  }

  return {
    ensure(botId, signal) {
      if (deps.placed(botId, deps.version)) return Promise.resolve()
      const current = running.get(botId)
      if (current !== undefined) return current
      const attempt = place(botId, signal).finally(() => {
        running.delete(botId)
      })
      running.set(botId, attempt)
      return attempt
    },
  }
}
