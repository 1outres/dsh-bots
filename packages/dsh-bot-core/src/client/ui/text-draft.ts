import { useCallback, useEffect, useReducer, useRef } from "react"
import type { CommitResult } from "./commit"
import { usePendingEdit } from "./pending-edits"

export interface DraftState {
  readonly text: string
  readonly base: string
  readonly error: string | null
  readonly busy: boolean
  readonly settled: boolean
}

export type DraftAction =
  | { readonly kind: "change"; readonly text: string }
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "reset" }

export const initialDraft = (value: string): DraftState => ({
  text: value,
  base: value,
  error: null,
  busy: false,
  settled: false,
})

export const isEditing = (state: DraftState): boolean => !state.settled && state.text !== state.base

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.kind) {
    case "change":
      return { ...state, text: action.text, error: null, settled: false }
    case "value":
      if (action.value === state.base && !state.settled) return state
      return isEditing(state) || state.busy
        ? { ...state, base: action.value }
        : initialDraft(action.value)
    case "invalid":
      return { ...state, error: action.error }
    case "saving":
      return { ...state, busy: true, error: null }
    case "saved":
      return { ...state, busy: false, settled: true }
    case "failed":
      return { ...state, busy: false, error: action.error }
    case "reset":
      return initialDraft(state.base)
  }
}

export interface TextDraftOptions {
  readonly value: string
  validate?(text: string): string | null
  commit(text: string): Promise<CommitResult>
}

export interface TextDraft {
  readonly text: string
  readonly error: string | null
  readonly editing: boolean
  readonly busy: boolean
  change(text: string): void
  commit(): void
  reset(): void
}

export function useTextDraft(options: TextDraftOptions): TextDraft {
  const [state, dispatch] = useReducer(draftReducer, options.value, initialDraft)
  const latest = useRef(options)
  latest.current = options
  const current = useRef(state)
  current.current = state

  useEffect(() => dispatch({ kind: "value", value: options.value }), [options.value])

  const commit = useCallback(() => {
    const draft = current.current
    if (draft.busy || !isEditing(draft)) return
    const problem = latest.current.validate?.(draft.text) ?? null
    if (problem !== null) {
      dispatch({ kind: "invalid", error: problem })
      return
    }
    dispatch({ kind: "saving" })
    void latest.current
      .commit(draft.text)
      .then((result) =>
        dispatch(result.ok ? { kind: "saved" } : { kind: "failed", error: result.message }),
      )
  }, [])
  const change = useCallback((text: string) => dispatch({ kind: "change", text }), [])
  const reset = useCallback(() => dispatch({ kind: "reset" }), [])

  const editing = isEditing(state)
  usePendingEdit(editing)
  return { text: state.text, error: state.error, editing, busy: state.busy, change, commit, reset }
}
