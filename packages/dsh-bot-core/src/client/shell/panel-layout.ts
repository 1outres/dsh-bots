export const CHAT_MIN_WIDTH = 640

export const MENU_BAR_WIDTH = 52

export type PanelLayout = "beside" | "overlay" | "sheet"

export interface PanelLayoutInput {
  readonly shellWidth: number | undefined
  readonly panelWidth: number
  readonly compact: boolean
}

export function panelLayout({ shellWidth, panelWidth, compact }: PanelLayoutInput): PanelLayout {
  if (compact) return "sheet"
  if (shellWidth === undefined) return "beside"
  return shellWidth - MENU_BAR_WIDTH - panelWidth < CHAT_MIN_WIDTH ? "overlay" : "beside"
}
