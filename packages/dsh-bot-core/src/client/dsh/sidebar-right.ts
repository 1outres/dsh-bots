export interface SidebarTab {
  readonly id: string
  readonly kind: string
  readonly contentId: string
}

export interface SidebarSurface {
  readonly layout: {
    readonly expanded: boolean
    readonly tabs: Readonly<Record<string, SidebarTab>>
  }
}

export interface SidebarState {
  readonly bySession: Readonly<Record<string, SidebarSurface | undefined>>
}

export interface SidebarActions {
  open(sessionId: string): void
  setExpanded(sessionId: string, expanded: boolean): void
}

export interface SidebarNavigation {
  readonly address: string
  readonly params?: unknown
}

export interface SidebarRightFace {
  closeIn(sessionId: string, tabId: string): void
  readonly tabDomain: {
    occurrence(
      sessionId: string,
      tab: { readonly id: string },
    ): { readonly navigation: { getSnapshot(): SidebarNavigation } }
  }
}

export interface SidebarRightTabsFace {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly patterns: readonly string[]
    readonly priority: "extension"
    readonly canOpen: (address: string) => boolean
    readonly title: (address: string) => string
  }): () => void
}

export interface TabInfo {
  readonly tab: {
    readonly navigation: SidebarNavigation & { readonly revision: number }
  }
}

export interface SidebarStoreProps {
  readonly useStore: <T>(selector: (state: SidebarState) => T) => T
  readonly actions: SidebarActions
}
