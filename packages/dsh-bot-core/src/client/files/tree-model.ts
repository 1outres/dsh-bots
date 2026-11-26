import type { BotDirectoryEntry } from "../../shared/files"
import type { TreeEntry } from "../dsh/sidebar-files"
import type { BotFileFailure } from "../file-failure"
import type { BotFilesClient } from "../files"
import { createStore, type Observable } from "../observable"
import { settle } from "./settle"

export type DirectoryState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: BotFileFailure }
  | { readonly status: "listed"; readonly truncated: boolean }

export interface TreeSnapshot {
  readonly entries: readonly TreeEntry[]
  readonly expanded: readonly string[]
  readonly directories: Readonly<Record<string, DirectoryState>>
}

export interface TreeModel extends Observable<TreeSnapshot> {
  load(): void
  toggle(path: string, expanded: boolean): void
  refresh(): void
  dispose(): void
}

const join = (directory: string, name: string) => (directory === "" ? name : `${directory}/${name}`)

function entryOf(directory: string, entry: BotDirectoryEntry): TreeEntry {
  return {
    path: join(directory, entry.name),
    name: entry.name,
    meta: {
      kind: entry.type,
      ...(entry.name.startsWith(".") ? { hidden: true } : {}),
      ...(entry.size === undefined ? {} : { size: entry.size }),
    },
  }
}

export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "")
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
}

const EMPTY: TreeSnapshot = { entries: [], expanded: [], directories: {} }

export function createTreeModel(files: BotFilesClient, sessionId: string): TreeModel {
  const listings = new Map<string, readonly TreeEntry[]>()
  const directories = new Map<string, DirectoryState>()
  const expanded = new Set<string>()
  const pending = new Map<string, AbortController>()
  const snapshot = createStore(EMPTY)
  let disposed = false

  const visible = (path: string) =>
    path === "" ||
    (expanded.has(path) && ancestorsOf(path).every((ancestor) => expanded.has(ancestor)))

  const publish = () => {
    const entries: TreeEntry[] = []
    for (const [directory, rows] of listings) if (visible(directory)) entries.push(...rows)
    snapshot.set({
      entries,
      expanded: [...expanded],
      directories: Object.fromEntries(directories),
    })
  }

  const list = (directory: string) => {
    pending.get(directory)?.abort()
    const controller = new AbortController()
    pending.set(directory, controller)
    directories.set(directory, { status: "loading" })
    publish()
    void settle(controller.signal, (signal) => files.list(sessionId, directory, signal)).then(
      (outcome) => {
        if (outcome.status === "aborted") return
        pending.delete(directory)
        if (outcome.status === "done") {
          listings.set(
            directory,
            outcome.value.entries.map((entry) => entryOf(directory, entry)),
          )
          directories.set(directory, { status: "listed", truncated: outcome.value.truncated })
        } else {
          directories.set(directory, { status: "failed", failure: outcome.failure })
        }
        publish()
      },
    )
  }

  const listed = (path: string) => listings.has(path) || pending.has(path)

  return {
    getSnapshot: snapshot.getSnapshot,
    subscribe: snapshot.subscribe,
    load() {
      if (!disposed && !listed("")) list("")
    },
    toggle(path, open) {
      if (disposed) return
      if (open) expanded.add(path)
      else expanded.delete(path)
      if (open && !listed(path)) list(path)
      else publish()
    },
    refresh() {
      if (disposed) return
      list("")
      for (const path of expanded) list(path)
    },
    dispose() {
      disposed = true
      for (const controller of pending.values()) controller.abort()
      pending.clear()
    },
  }
}
