import { createContext, useContext, useEffect } from "react"

/** A surface that asks before typed, unsaved text is dropped (a settings screen). */
export interface PendingEdits {
  /** Mark typed text as unsaved until the returned release is called. */
  hold(): () => void
}

/** The surface an inline editor is in; `null` where nothing asks before text is dropped (a dialog). */
export const PendingEditsContext = createContext<PendingEdits | null>(null)

/** Hold the surrounding surface while `pending` (an inline editor with typed, unsaved text). */
export function usePendingEdit(pending: boolean): void {
  const edits = useContext(PendingEditsContext)
  useEffect(() => (pending && edits !== null ? edits.hold() : undefined), [pending, edits])
}
