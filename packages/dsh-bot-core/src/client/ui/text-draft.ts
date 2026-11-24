import { useCallback, useEffect, useReducer, useRef } from "react"
import type { CommitResult } from "./commit"
import { usePendingEdit } from "./pending-edits"

/** A single-line value typed in place: what is shown, and whether it waits for a save. */
export interface DraftState {
  readonly text: string
  /** The saved value the text was typed over. */
  readonly base: string
  readonly error: string | null
  readonly busy: boolean
  /** A save succeeded; the text follows the next saved value however the owner stored it. */
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

/** Whether the text differs from the saved value and is not on its way to it. */
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
  /** The saved value. */
  readonly value: string
  /** What is wrong with `text`, in the user's language; `null` when it can be saved. */
  validate?(text: string): string | null
  /** Save `text`; a failure keeps the text and shows the message. */
  commit(text: string): Promise<CommitResult>
}

/** A text field's draft, saved when committed (Enter or leaving the field). */
export interface TextDraft {
  readonly text: string
  /** The validation or save failure shown on the field. */
  readonly error: string | null
  /** Typed text that is not saved: the surrounding settings screen asks before dropping it. */
  readonly editing: boolean
  readonly busy: boolean
  change(text: string): void
  /** Save the text when it changed and is valid. */
  commit(): void
  /** Drop the typed text. */
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
