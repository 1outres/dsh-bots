/** The narrowest the conversation column gets beside a panel (DSH's CONTENT_MIN). */
export const CHAT_MIN_WIDTH = 640

/** The menu bar's width beside the chat and its panel. */
export const MENU_BAR_WIDTH = 52

/**
 * How a side panel sits in the shell: `beside` the chat (it narrows it),
 * `overlay` over the chat from the right (the chat keeps its width), or a
 * full-screen `sheet` on a compact window.
 */
export type PanelLayout = "beside" | "overlay" | "sheet"

export interface PanelLayoutInput {
  /** The shell's width, menu bar included; undefined until it is measured. */
  readonly shellWidth: number | undefined
  readonly panelWidth: number
  readonly compact: boolean
}

export function panelLayout({ shellWidth, panelWidth, compact }: PanelLayoutInput): PanelLayout {
  if (compact) return "sheet"
  if (shellWidth === undefined) return "beside"
  return shellWidth - MENU_BAR_WIDTH - panelWidth < CHAT_MIN_WIDTH ? "overlay" : "beside"
}
