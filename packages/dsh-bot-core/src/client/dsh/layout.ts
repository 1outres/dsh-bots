import type { Observable } from "../observable"

export interface PanelInfo {
  readonly activePanelId: string | null
}

export interface LayoutFace {
  readonly panelInfo: Observable<PanelInfo>
  selectPanel(panelId: string | null): void
  toggleSidebar(): void
}

export const OPEN_DRAWER_FRAME = "[data-sidebar-drawer]:not([data-sidebar-collapsed])"
