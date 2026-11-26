import { useEffect, useState } from "react"

/** An answer read from the Host while its key stays the same. */
export type QueryState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly message: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Read `load` again whenever `key` changes, cancelling the read before. */
export function useQuery<T>(key: string, load: (signal: AbortSignal) => Promise<T>): QueryState<T> {
  const [state, setState] = useState<{ readonly key: string; readonly state: QueryState<T> }>({
    key,
    state: { status: "loading" },
  })
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, state: { status: "loading" } })
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, state: { status: "ready", value } })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, state: { status: "failed", message: messageOf(error) } })
      },
    )
    return () => controller.abort()
  }, [key])
  return state.key === key ? state.state : { status: "loading" }
}
