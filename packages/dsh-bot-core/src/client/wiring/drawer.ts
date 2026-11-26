import { OPEN_DRAWER_FRAME } from "../dsh/layout"
import { derive, type Observable } from "../observable"
import type { ClientContext } from "../types"

export interface DrawerFace {
  isOpen(): boolean
  close(): void
}

export function closeDrawerOnOpen(drawer: DrawerFace, opened: Observable<boolean>): () => void {
  let shown = opened.getSnapshot()
  return opened.subscribe(() => {
    const next = opened.getSnapshot()
    if (next && !shown && drawer.isOpen()) drawer.close()
    shown = next
  })
}

export type ModalSources = readonly Observable<unknown>[]

export function wireDrawer(ctx: ClientContext, modals: ModalSources): void {
  const drawer: DrawerFace = {
    isOpen: () => document.querySelector(OPEN_DRAWER_FRAME) !== null,
    close: () => ctx.layout.toggleSidebar(),
  }
  const opened = derive(modals, (...values) =>
    values.some((value) => value !== null && value !== false),
  )
  ctx.effect(
    () => closeDrawerOnOpen(drawer, opened),
    "bot-core: close the sidebar drawer under modals",
  )
}
