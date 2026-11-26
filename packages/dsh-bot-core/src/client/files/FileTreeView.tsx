import { useEffect } from "react"
import type { Translate } from "../dsh/context"
import type { FileTreeInput, TreeDirectoryState, TreeEntry } from "../dsh/sidebar-files"
import { FACTORY, type RenderFactory } from "../dsh/slots"
import { failureKey } from "../file-failure"
import type { SearchMatches } from "./search-model"
import type { DirectoryState, TreeSnapshot } from "./tree-model"

export interface TreeHandlers {
  readonly onToggle: (entry: TreeEntry, expanded: boolean) => void
  readonly onOpen: (entry: TreeEntry) => void
  readonly current?: string | undefined
  readonly currentRef?: ((row: HTMLElement | null) => void) | undefined
}

function directoryState(t: Translate, state: DirectoryState): TreeDirectoryState {
  switch (state.status) {
    case "loading":
      return { loading: true }
    case "failed":
      return { failure: t(failureKey(state.failure)) }
    case "listed":
      return state.truncated ? { truncated: true } : {}
  }
}

export function browseInput(
  t: Translate,
  snapshot: TreeSnapshot,
  handlers: TreeHandlers,
): FileTreeInput {
  return {
    root: "",
    entries: snapshot.entries,
    expanded: snapshot.expanded,
    directories: Object.fromEntries(
      Object.entries(snapshot.directories).map(([path, state]) => [path, directoryState(t, state)]),
    ),
    ...handlers,
  }
}

const UNMATCHED: TreeDirectoryState = { omitted: "unmatched" }

export function searchInput(
  term: string,
  matches: SearchMatches,
  handlers: TreeHandlers,
): FileTreeInput {
  const directories = matches.entries
    .filter((entry) => entry.meta?.kind === "directory")
    .map((entry) => [entry.path, UNMATCHED] as const)
  return {
    root: "",
    entries: matches.entries,
    expanded: matches.expanded,
    directories: Object.fromEntries([["", UNMATCHED], ...directories]),
    highlight: term,
    ...handlers,
  }
}

const NO_SLOTS = {}

export function FileTreeView(props: {
  t: Translate
  renderFactory: RenderFactory
  input: FileTreeInput
}) {
  const { t, renderFactory, input } = props
  return (
    <>
      {renderFactory(FACTORY.filesTree, input, {
        slots: NO_SLOTS,
        fallback: <TreeUnavailable t={t} />,
      })}
    </>
  )
}

let reported = false

export function TreeUnavailable({ t }: { t: Translate }) {
  useEffect(() => {
    if (reported) return
    reported = true
    console.error(
      `bot-core: DSH's "${FACTORY.filesTree}" Factory is not registered; the bot file tree cannot be shown`,
    )
  }, [])
  return (
    <p className="dshb-files-note" role="alert" data-dshb-files-tree-unavailable="">
      {t("files.error.tree-unavailable")}
    </p>
  )
}
