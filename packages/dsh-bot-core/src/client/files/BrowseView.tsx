import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef } from "react"
import type { Translate } from "../dsh/context"
import type { RenderFactory } from "../dsh/slots"
import { failureKey } from "../file-failure"
import { useObservable } from "../hooks"
import { localeFormat } from "../locale-format"
import { browseInput, FileTreeView, searchInput, type TreeHandlers } from "./FileTreeView"
import type { FilesFace } from "./files-face"
import type { PanelFocus } from "./panel-focus"
import type { SearchResult } from "./search-model"

export interface BrowseViewProps {
  readonly t: Translate
  readonly sessionId: string
  readonly face: FilesFace
  readonly renderFactory: RenderFactory
  /** The file shown last, marked in the tree. */
  readonly current: string | undefined
  readonly focus: PanelFocus
}

function searchSummary(t: Translate, result: SearchResult): string {
  switch (result.status) {
    case "idle":
      return ""
    case "loading":
      return t("files.search.loading")
    case "failed":
      return t(failureKey(result.failure))
    case "ready": {
      if (result.entries.length === 0) return t("files.search.none")
      const count = result.entries.filter((entry) => entry.meta?.kind !== "directory").length
      return localeFormat(t).count(
        result.truncated ? "files.search.countTruncated" : "files.search.count",
        count,
      )
    }
  }
}

/** The workspace tree, or the matches of a search typed above it. */
export function BrowseView({ t, sessionId, face, renderFactory, current, focus }: BrowseViewProps) {
  const tree = face.treeOf(sessionId)
  const search = face.searchOf(sessionId)
  const snapshot = useObservable(tree)
  const { query, result } = useObservable(search)
  const linksAvailable = useObservable(face.linksAvailable)
  const searchField = useRef<HTMLInputElement>(null)
  useEffect(() => tree.load(), [tree])
  useEffect(() => {
    if (focus.take("browser")) searchField.current?.focus()
  })

  const onOpen = useCallback(
    (entry: { readonly path: string }) => {
      focus.request("preview")
      face.viewer.openFile(sessionId, entry.path)
    },
    [focus, face.viewer, sessionId],
  )
  const currentRef = useCallback(
    (row: HTMLElement | null) => {
      if (row !== null && focus.take("browser")) row.focus()
    },
    [focus],
  )
  const browsing = useMemo<TreeHandlers>(
    () => ({
      onToggle: (entry, expanded) => tree.toggle(entry.path, expanded),
      onOpen,
      current,
      currentRef,
    }),
    [tree, onOpen, current, currentRef],
  )
  const searching = useMemo<TreeHandlers>(
    () => ({
      onToggle: (entry, expanded) => search.toggle(entry.path, expanded),
      onOpen,
      current,
      currentRef,
    }),
    [search, onOpen, current, currentRef],
  )
  const input = useMemo(() => {
    if (result.status === "idle") return browseInput(t, snapshot, browsing)
    if (result.status === "ready") return searchInput(result.term, result, searching)
    return undefined
  }, [t, snapshot, result, browsing, searching])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || query === "") return
    event.preventDefault()
    search.setQuery("")
  }

  return (
    <>
      <div className="dshb-files-search">
        <input
          ref={searchField}
          type="search"
          className="dshb-files-input"
          value={query}
          placeholder={t("files.search")}
          aria-label={t("files.search")}
          onChange={(event) => search.setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {!linksAvailable && (
        <p className="dshb-files-note" role="note">
          {t("files.linksUnavailable")}
        </p>
      )}
      <p className="dshb-files-count" role="status" aria-live="polite">
        {searchSummary(t, result)}
      </p>
      <div className="dshb-files-tree" aria-busy={result.status === "loading" || undefined}>
        {input !== undefined && <FileTreeView t={t} renderFactory={renderFactory} input={input} />}
      </div>
    </>
  )
}
