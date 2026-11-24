// Source: dsh-client-ui-sidebar-right/src/client/{stores.ts,service.ts,tab-domain.ts,contract/slots.ts}.

/** One tab record of the layout (dockkit `TabRecord`), as far as bot-core reads it. */
export interface SidebarTab {
  readonly id: string
  readonly kind: string
  readonly contentId: string
}

/** One session's surface in the sidebar store (stores.ts `SurfaceState`). */
export interface SidebarSurface {
  readonly layout: {
    readonly expanded: boolean
    readonly tabs: Readonly<Record<string, SidebarTab>>
  }
}

/** The sidebar store state (stores.ts `SidebarRightState`). */
export interface SidebarState {
  readonly bySession: Readonly<Record<string, SidebarSurface | undefined>>
}

/** The store actions bot-core uses (stores.ts `open`, `setExpanded`). */
export interface SidebarActions {
  open(sessionId: string): void
  setExpanded(sessionId: string, expanded: boolean): void
}

/** A tab's last navigation (`SidebarRightTabNavigation`, without `revision`). */
export interface SidebarNavigation {
  readonly address: string
  readonly params?: unknown
}

/** `ctx.sidebarRight`: the controller's Tab-domain paths. */
export interface SidebarRightFace {
  closeIn(sessionId: string, tabId: string): void
  readonly tabDomain: {
    occurrence(
      sessionId: string,
      tab: { readonly id: string },
    ): { readonly navigation: { getSnapshot(): SidebarNavigation } }
  }
}

/** `ctx.sidebarRightTabs`: the tab type registry. */
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

/** What a `sidebar.right.pane.tab` body reads from its `tabInfo` hook (`SidebarRightTabInfo`). */
export interface TabInfo {
  readonly tab: {
    readonly navigation: SidebarNavigation & { readonly revision: number }
  }
}

/** The store props an entry receives while its registration declares the sidebar store handle. */
export interface SidebarStoreProps {
  readonly useStore: <T>(selector: (state: SidebarState) => T) => T
  readonly actions: SidebarActions
}
