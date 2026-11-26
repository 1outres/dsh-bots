import { createContext, useContext, useEffect } from "react"

export interface PendingEdits {
  hold(): () => void
}

export const PendingEditsContext = createContext<PendingEdits | null>(null)

export function usePendingEdit(pending: boolean): void {
  const edits = useContext(PendingEditsContext)
  useEffect(() => (pending && edits !== null ? edits.hold() : undefined), [pending, edits])
}
