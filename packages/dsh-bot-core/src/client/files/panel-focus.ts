export type FocusTarget = "preview" | "browser"

export interface PanelFocus {
  request(target: FocusTarget): void
  take(target: FocusTarget): boolean
}

export function createPanelFocus(): PanelFocus {
  let pending: FocusTarget | undefined
  return {
    request(target) {
      pending = target
    },
    take(target) {
      if (pending !== target) return false
      pending = undefined
      return true
    },
  }
}
