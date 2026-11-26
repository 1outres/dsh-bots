import { createStore, type Observable } from "./observable"

export type ViewerContent =
  | { readonly kind: "browse" }
  | {
      readonly kind: "file"
      readonly path: string
      readonly line?: number
      readonly serial: number
    }
  | {
      readonly kind: "document"
      readonly title: string
      readonly markdown: string
      readonly serial: number
    }

export interface SessionViewer {
  readonly open: boolean
  readonly content: ViewerContent
  readonly lastFile?: string
}

export interface ViewerNotice {
  readonly key: string
  readonly params?: Readonly<Record<string, string>>
  readonly serial: number
}

export interface ViewerState {
  readonly sessions: Readonly<Record<string, SessionViewer>>
  readonly notices: Readonly<Record<string, ViewerNotice>>
}

export interface Viewer extends Observable<ViewerState> {
  of(sessionId: string): SessionViewer
  openFile(sessionId: string, path: string, line?: number): void
  browse(sessionId: string): void
  showDocument(sessionId: string, title: string, markdown: string): void
  refresh(sessionId: string): void
  toggle(sessionId: string): void
  close(sessionId: string): void
  notify(sessionId: string, key: string, params?: Readonly<Record<string, string>>): void
  dismiss(sessionId: string): void
  forget(keep: (sessionId: string) => boolean): void
}

const BROWSE: ViewerContent = { kind: "browse" }
const CLOSED: SessionViewer = { open: false, content: BROWSE }

export function createViewer(): Viewer {
  const state = createStore<ViewerState>({ sessions: {}, notices: {} })
  let serial = 0
  const next = () => {
    serial += 1
    return serial
  }
  const set = (sessionId: string, viewer: SessionViewer) =>
    state.update((current) => ({
      ...current,
      sessions: { ...current.sessions, [sessionId]: viewer },
    }))
  const of = (sessionId: string) => state.getSnapshot().sessions[sessionId] ?? CLOSED
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    of,
    openFile(sessionId, path, line) {
      set(sessionId, {
        open: true,
        content: { kind: "file", path, ...(line === undefined ? {} : { line }), serial: next() },
        lastFile: path,
      })
    },
    browse(sessionId) {
      set(sessionId, { ...of(sessionId), open: true, content: BROWSE })
    },
    showDocument(sessionId, title, markdown) {
      set(sessionId, {
        ...of(sessionId),
        open: true,
        content: { kind: "document", title, markdown, serial: next() },
      })
    },
    refresh(sessionId) {
      const current = of(sessionId)
      if (current.content.kind !== "file") return
      set(sessionId, { ...current, content: { ...current.content, serial: next() } })
    },
    toggle(sessionId) {
      const current = of(sessionId)
      set(sessionId, { ...current, open: !current.open })
    },
    close(sessionId) {
      const current = of(sessionId)
      if (current.open) set(sessionId, { ...current, open: false })
    },
    notify(sessionId, key, params) {
      const notice = { key, ...(params === undefined ? {} : { params }), serial: next() }
      state.update((current) => ({
        ...current,
        notices: { ...current.notices, [sessionId]: notice },
      }))
    },
    dismiss(sessionId) {
      const { notices } = state.getSnapshot()
      if (notices[sessionId] === undefined) return
      const { [sessionId]: _dismissed, ...rest } = notices
      state.update((current) => ({ ...current, notices: rest }))
    },
    forget(keep) {
      const current = state.getSnapshot()
      const kept = <T>(record: Readonly<Record<string, T>>) =>
        Object.fromEntries(Object.entries(record).filter(([id]) => keep(id)))
      const sessions = kept(current.sessions)
      const notices = kept(current.notices)
      if (
        Object.keys(sessions).length === Object.keys(current.sessions).length &&
        Object.keys(notices).length === Object.keys(current.notices).length
      ) {
        return
      }
      state.set({ sessions, notices })
    },
  }
}
