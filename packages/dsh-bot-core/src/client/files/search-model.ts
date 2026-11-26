import type { BotFileSearchResult } from "../../shared/files"
import type { TreeEntry } from "../dsh/sidebar-files"
import type { BotFileFailure } from "../file-failure"
import type { BotFilesClient } from "../files"
import { createStore, type Observable } from "../observable"
import { settle } from "./settle"
import { ancestorsOf } from "./tree-model"

export const SEARCH_DELAY_MS = 250

export interface Timers {
  set(run: () => void, delay: number): unknown
  clear(handle: unknown): void
}

export const BROWSER_TIMERS: Timers = {
  set: (run, delay) => setTimeout(run, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface SearchMatches {
  readonly entries: readonly TreeEntry[]
  readonly expanded: readonly string[]
  readonly truncated: boolean
}

export type SearchResult =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly term: string }
  | ({ readonly status: "ready"; readonly term: string } & SearchMatches)
  | { readonly status: "failed"; readonly term: string; readonly failure: BotFileFailure }

export interface SearchState {
  readonly query: string
  readonly result: SearchResult
}

export interface SearchModel extends Observable<SearchState> {
  setQuery(query: string): void
  toggle(path: string, expanded: boolean): void
  refresh(): void
  cancel(): void
}

export function searchMatches(result: BotFileSearchResult): SearchMatches {
  const entries = result.matches.map((match) => ({
    path: match.path,
    name: match.path.slice(match.path.lastIndexOf("/") + 1),
    meta: { kind: match.type },
  }))
  const expanded = new Set<string>()
  for (const match of result.matches) {
    for (const ancestor of ancestorsOf(match.path)) expanded.add(ancestor)
    if (match.type === "directory") expanded.add(match.path)
  }
  return {
    entries,
    expanded: [...expanded],
    truncated: result.truncated || result.incomplete,
  }
}

const IDLE: SearchResult = { status: "idle" }

export function createSearchModel(
  files: BotFilesClient,
  sessionId: string,
  timers: Timers,
): SearchModel {
  const state = createStore<SearchState>({ query: "", result: IDLE })
  let timer: { readonly handle: unknown } | undefined
  let controller: AbortController | undefined

  const stop = () => {
    if (timer !== undefined) timers.clear(timer.handle)
    timer = undefined
    controller?.abort()
    controller = undefined
  }

  const setResult = (result: SearchResult) => state.update((current) => ({ ...current, result }))

  const run = (term: string) => {
    controller = new AbortController()
    const { signal } = controller
    void settle(signal, (s) => files.search(sessionId, { query: term }, s)).then((outcome) => {
      switch (outcome.status) {
        case "aborted":
          return
        case "done":
          setResult({ status: "ready", term, ...searchMatches(outcome.value) })
          return
        case "failed":
          setResult({ status: "failed", term, failure: outcome.failure })
          return
      }
    })
  }

  const search = (term: string) => {
    stop()
    if (term === "") {
      setResult(IDLE)
      return
    }
    setResult({ status: "loading", term })
    timer = { handle: timers.set(() => run(term), SEARCH_DELAY_MS) }
  }

  const termOf = (result: SearchResult) => (result.status === "idle" ? "" : result.term)

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    setQuery(query) {
      const { result } = state.getSnapshot()
      state.update((current) => ({ ...current, query }))
      const term = query.trim()
      if (term !== termOf(result)) search(term)
    },
    toggle(path, open) {
      state.update((current) => {
        const { result } = current
        if (result.status !== "ready") return current
        const expanded = result.expanded.filter((item) => item !== path)
        return {
          ...current,
          result: { ...result, expanded: open ? [...expanded, path] : expanded },
        }
      })
    },
    refresh() {
      search(termOf(state.getSnapshot().result))
    },
    cancel() {
      stop()
      if (state.getSnapshot().result.status === "loading") setResult(IDLE)
    },
  }
}
