import { useCallback, useReducer, useRef } from "react"
import type { CommitResult } from "./commit"
import { usePendingEdit } from "./pending-edits"

export interface SecretEditorState {
  readonly open: boolean
  readonly text: string
  readonly error: string | null
  readonly busy: boolean
}

export type SecretEditorAction =
  | { readonly kind: "open" }
  | { readonly kind: "change"; readonly text: string }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "close" }

export const CLOSED_SECRET: SecretEditorState = { open: false, text: "", error: null, busy: false }

export function secretEditorReducer(
  state: SecretEditorState,
  action: SecretEditorAction,
): SecretEditorState {
  switch (action.kind) {
    case "open":
      return { open: true, text: "", error: null, busy: false }
    case "change":
      return { ...state, text: action.text, error: null }
    case "invalid":
      return { ...state, error: action.error }
    case "saving":
      return { ...state, busy: true, error: null }
    case "failed":
      return { ...state, busy: false, error: action.error }
    case "close":
      return CLOSED_SECRET
  }
}

export interface SecretEditorOptions {
  validate?(secret: string): string | null
  commit(secret: string): Promise<CommitResult>
  remove?(): Promise<CommitResult>
}

export interface SecretEditor extends SecretEditorState {
  start(): void
  change(text: string): void
  submit(): void
  cancel(): void
  remove(): void
}

export function useSecretEditor(options: SecretEditorOptions): SecretEditor {
  const [state, dispatch] = useReducer(secretEditorReducer, CLOSED_SECRET)
  const latest = useRef(options)
  latest.current = options
  const current = useRef(state)
  current.current = state

  const settle = useCallback(
    (result: CommitResult) =>
      dispatch(result.ok ? { kind: "close" } : { kind: "failed", error: result.message }),
    [],
  )
  const submit = useCallback(() => {
    const editor = current.current
    if (!editor.open || editor.busy || editor.text === "") return
    const problem = latest.current.validate?.(editor.text) ?? null
    if (problem !== null) {
      dispatch({ kind: "invalid", error: problem })
      return
    }
    dispatch({ kind: "saving" })
    void latest.current.commit(editor.text).then(settle)
  }, [settle])
  const remove = useCallback(() => {
    const removal = latest.current.remove
    if (removal === undefined || current.current.busy) return
    dispatch({ kind: "saving" })
    void removal().then(settle)
  }, [settle])

  usePendingEdit(state.open && state.text !== "")
  return {
    ...state,
    start: useCallback(() => dispatch({ kind: "open" }), []),
    change: useCallback((text: string) => dispatch({ kind: "change", text }), []),
    submit,
    cancel: useCallback(() => dispatch({ kind: "close" }), []),
    remove,
  }
}
