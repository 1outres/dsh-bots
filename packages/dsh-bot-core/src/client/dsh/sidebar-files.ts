// Source: dsh-client-ui-sidebar-files/src/client/FileTree.tsx.

/** `TreeEntryMeta`. */
export interface TreeEntryMeta {
  readonly kind?: "file" | "directory" | "other"
  readonly hidden?: boolean
  readonly size?: number
}

/** `TreeEntry`. */
export interface TreeEntry {
  readonly path: string
  readonly name: string
  readonly meta?: TreeEntryMeta
}

/** `TreeDirectoryState`; `failure` is already localized. */
export interface TreeDirectoryState {
  readonly loading?: true
  readonly failure?: string
  readonly truncated?: true
  readonly omitted?: "hidden" | "unmatched"
}

/** `FileTreeInput`, the `sidebar.files.tree` Factory's input, as far as bot-core fills it. */
export interface FileTreeInput {
  readonly root: string
  readonly entries: readonly TreeEntry[]
  readonly expanded: readonly string[]
  readonly directories?: Readonly<Record<string, TreeDirectoryState>>
  readonly highlight?: string
  readonly current?: string | undefined
  /** Receives the current file's row button while it is drawn. */
  readonly currentRef?: ((row: HTMLElement | null) => void) | undefined
  readonly onToggle: (entry: TreeEntry, expanded: boolean) => void
  readonly onOpen: (entry: TreeEntry) => void
}
