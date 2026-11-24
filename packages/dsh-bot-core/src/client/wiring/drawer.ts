import { OPEN_DRAWER_FRAME } from "../dsh/layout"
import { derive, type Observable } from "../observable"
import type { ClientContext } from "../types"

export interface DrawerFace {
  /** Whether DSH's sidebar is an open drawer over the app. */
  isOpen(): boolean
  close(): void
}

/** Close the drawer whenever `opened` turns true, so a modal of bot-core's is not under it. */
export function closeDrawerOnOpen(drawer: DrawerFace, opened: Observable<boolean>): () => void {
  let shown = opened.getSnapshot()
  return opened.subscribe(() => {
    const next = opened.getSnapshot()
    if (next && !shown && drawer.isOpen()) drawer.close()
    shown = next
  })
}

/** bot-core's modals and dialogs, each open or not. */
export type ModalSources = readonly Observable<unknown>[]

/** Open bot-core's modals and dialogs (settings, New bot, the archive confirmation) on a narrow window with DSH's drawer closed first. */
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
