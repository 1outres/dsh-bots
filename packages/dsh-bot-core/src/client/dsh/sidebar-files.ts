export interface TreeEntryMeta {
  readonly kind?: "file" | "directory" | "other"
  readonly hidden?: boolean
  readonly size?: number
}

export interface TreeEntry {
  readonly path: string
  readonly name: string
  readonly meta?: TreeEntryMeta
}

export interface TreeDirectoryState {
  readonly loading?: true
  readonly failure?: string
  readonly truncated?: true
  readonly omitted?: "hidden" | "unmatched"
}

export interface FileTreeInput {
  readonly root: string
  readonly entries: readonly TreeEntry[]
  readonly expanded: readonly string[]
  readonly directories?: Readonly<Record<string, TreeDirectoryState>>
  readonly highlight?: string
  readonly current?: string | undefined
  readonly currentRef?: ((row: HTMLElement | null) => void) | undefined
  readonly onToggle: (entry: TreeEntry, expanded: boolean) => void
  readonly onOpen: (entry: TreeEntry) => void
}
