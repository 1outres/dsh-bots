import type { SessionEventLike } from "./feed"

export interface PresentedFile {
  readonly path: string
  readonly description?: string
}

export interface Presentation {
  readonly turn: number
  readonly files: readonly PresentedFile[]
}

export const PRESENTED_EVENT = "deliverables/presented"

export function presentationOf(event: SessionEventLike): Presentation | undefined {
  if (event.type !== PRESENTED_EVENT) return undefined
  const data = event.data as Presentation
  return {
    turn: data.turn,
    files: data.files.map((file) => {
      const description = file.description?.trim()
      return description === undefined || description === ""
        ? { path: file.path }
        : { path: file.path, description }
    }),
  }
}

export interface PresentedFiles {
  record(sessionId: string, presentation: Presentation): void
  take(sessionId: string, turn: number): readonly PresentedFile[]
  forget(sessionId: string): void
}

export function createPresentedFiles(): PresentedFiles {
  const collected = new Map<
    string,
    { readonly turn: number; readonly files: Map<string, PresentedFile> }
  >()
  return {
    record(sessionId, presentation) {
      let current = collected.get(sessionId)
      if (current?.turn !== presentation.turn) {
        current = { turn: presentation.turn, files: new Map() }
        collected.set(sessionId, current)
      }
      for (const file of presentation.files) current.files.set(file.path, file)
    },
    take(sessionId, turn) {
      const current = collected.get(sessionId)
      collected.delete(sessionId)
      return current?.turn === turn ? [...current.files.values()] : []
    },
    forget(sessionId) {
      collected.delete(sessionId)
    },
  }
}
