// Source: dsh-client-ui-layout src/client/service.ts (`ILayout`) and AppFrame.tsx (the frame's data attributes).

/** `ctx.layout`, as far as bot-core uses it. */
export interface LayoutFace {
  /** Toggle the sidebar; on a narrow window this opens or closes its drawer. */
  toggleSidebar(): void
}

/** The app frame while its sidebar is an open drawer: AppFrame marks a drawer frame, and a closed one as collapsed too. */
export const OPEN_DRAWER_FRAME = "[data-sidebar-drawer]:not([data-sidebar-collapsed])"
