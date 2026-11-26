import { createStore, type Observable } from "../observable"
import type { SessionViewer, Viewer } from "../viewer"
import type { OpenPanels, SidePanels } from "./side-panels"

export interface ShellPopover {
  readonly kind: "connector"
  readonly connectorId: string
}

export type OpenPopovers = Readonly<Record<string, ShellPopover>>

export const connectorPopover = (connectorId: string): ShellPopover => ({
  kind: "connector",
  connectorId,
})

export function samePopover(a: ShellPopover | undefined, b: ShellPopover): boolean {
  return a !== undefined && a.kind === b.kind && a.connectorId === b.connectorId
}

export interface ShellPopoversSources {
  readonly panels: Pick<SidePanels, "getSnapshot" | "subscribe">
  readonly viewer: Pick<Viewer, "of" | "subscribe">
}

export interface ShellPopovers extends Observable<OpenPopovers> {
  of(sessionId: string): ShellPopover | undefined
  open(sessionId: string, popover: ShellPopover): void
  toggle(sessionId: string, popover: ShellPopover): void
  close(sessionId: string): void
  forget(keep: (sessionId: string) => boolean): void
  dispose(): void
}

export function createShellPopovers(sources: ShellPopoversSources): ShellPopovers {
  const { panels, viewer } = sources
  const state = createStore<OpenPopovers>({})
  const viewersSeen = new Map<string, SessionViewer>()
  let panelsSeen: OpenPanels = panels.getSnapshot()
  const keepOnly = (kept: OpenPopovers) => {
    for (const sessionId of [...viewersSeen.keys()]) {
      if (kept[sessionId] === undefined) viewersSeen.delete(sessionId)
    }
    state.set(kept)
  }
  const close = (sessionId: string) => {
    const { [sessionId]: closed, ...rest } = state.getSnapshot()
    if (closed !== undefined) keepOnly(rest)
  }
  const open = (sessionId: string, popover: ShellPopover) => {
    if (samePopover(state.getSnapshot()[sessionId], popover)) return
    viewersSeen.set(sessionId, viewer.of(sessionId))
    state.set({ ...state.getSnapshot(), [sessionId]: popover })
  }
  const offPanels = panels.subscribe(() => {
    const before = panelsSeen
    panelsSeen = panels.getSnapshot()
    for (const sessionId of Object.keys(state.getSnapshot())) {
      const panel = panelsSeen[sessionId]
      if (panel !== undefined && panel !== before[sessionId]) close(sessionId)
    }
  })
  const offViewer = viewer.subscribe(() => {
    for (const sessionId of Object.keys(state.getSnapshot())) {
      const current = viewer.of(sessionId)
      if (current === viewersSeen.get(sessionId)) continue
      if (current.open) close(sessionId)
      else viewersSeen.set(sessionId, current)
    }
  })
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    of: (sessionId) => state.getSnapshot()[sessionId],
    open,
    toggle(sessionId, popover) {
      if (samePopover(state.getSnapshot()[sessionId], popover)) close(sessionId)
      else open(sessionId, popover)
    },
    close,
    forget(keep) {
      const current = state.getSnapshot()
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => keep(id)))
      if (Object.keys(kept).length !== Object.keys(current).length) keepOnly(kept)
    },
    dispose() {
      offPanels()
      offViewer()
    },
  }
}
