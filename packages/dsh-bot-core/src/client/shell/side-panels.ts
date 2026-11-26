import { createStore, type Observable } from "../observable"
import type { Viewer } from "../viewer"

export type SidePanel =
  | { readonly kind: "notes" }
  | { readonly kind: "actions" }
  | { readonly kind: "session-log" }
  | { readonly kind: "connector"; readonly connectorId: string }

export type OpenPanels = Readonly<Record<string, SidePanel>>

export const NOTES_PANEL: SidePanel = { kind: "notes" }

export const ACTIONS_PANEL: SidePanel = { kind: "actions" }

export const SESSION_LOG_PANEL: SidePanel = { kind: "session-log" }

export const connectorPanel = (connectorId: string): SidePanel => ({
  kind: "connector",
  connectorId,
})

export function samePanel(a: SidePanel | undefined, b: SidePanel): boolean {
  if (a === undefined || a.kind !== b.kind) return false
  return a.kind !== "connector" || (b.kind === "connector" && a.connectorId === b.connectorId)
}

export interface SidePanels extends Observable<OpenPanels> {
  of(sessionId: string): SidePanel | undefined
  open(sessionId: string, panel: SidePanel): void
  toggle(sessionId: string, panel: SidePanel): void
  close(sessionId: string): void
  forget(keep: (sessionId: string) => boolean): void
  dispose(): void
}

export function createSidePanels(viewer: Pick<Viewer, "of" | "close" | "subscribe">): SidePanels {
  const state = createStore<OpenPanels>({})
  const without = (sessionId: string) => {
    const { [sessionId]: _closed, ...rest } = state.getSnapshot()
    return rest
  }
  const close = (sessionId: string) => {
    if (state.getSnapshot()[sessionId] !== undefined) state.set(without(sessionId))
  }
  const open = (sessionId: string, panel: SidePanel) => {
    viewer.close(sessionId)
    if (samePanel(state.getSnapshot()[sessionId], panel)) return
    state.set({ ...state.getSnapshot(), [sessionId]: panel })
  }
  const offViewer = viewer.subscribe(() => {
    for (const sessionId of Object.keys(state.getSnapshot())) {
      if (viewer.of(sessionId).open) close(sessionId)
    }
  })
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    of: (sessionId) => state.getSnapshot()[sessionId],
    open,
    toggle(sessionId, panel) {
      if (samePanel(state.getSnapshot()[sessionId], panel)) close(sessionId)
      else open(sessionId, panel)
    },
    close,
    forget(keep) {
      const current = state.getSnapshot()
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => keep(id)))
      if (Object.keys(kept).length !== Object.keys(current).length) state.set(kept)
    },
    dispose: offViewer,
  }
}
