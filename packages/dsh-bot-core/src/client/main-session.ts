import type { SessionListState, WorkspaceSnapshot } from "./dsh/context"
import type { UiSessionFace } from "./dsh/session"
import { derive, type Observable } from "./observable"

export function mainSession(
  uiSession: Pick<UiSessionFace, "adapter">,
): Observable<string | undefined> {
  const current = uiSession.adapter.current
  return {
    getSnapshot() {
      const key = current.getSnapshot().key
      return typeof key === "string" ? key : undefined
    },
    subscribe: (listener) => current.subscribe(listener),
  }
}

export type MainBinding =
  | { readonly kind: "settling" }
  | { readonly kind: "none" }
  | { readonly kind: "session"; readonly sessionId: string }

const SETTLING: MainBinding = { kind: "settling" }
const NONE: MainBinding = { kind: "none" }

export function mainBindingOf(
  sessionId: string | undefined,
  sessions: Pick<SessionListState, "phase">,
  workspaces: Pick<WorkspaceSnapshot, "phase">,
): MainBinding {
  if (sessionId !== undefined) return { kind: "session", sessionId }
  return sessions.phase === "ready" && workspaces.phase === "ready" ? NONE : SETTLING
}

const sameBinding = (a: MainBinding, b: MainBinding) =>
  a.kind === b.kind &&
  (a.kind !== "session" || (b.kind === "session" && a.sessionId === b.sessionId))

export interface MainBindingSources {
  readonly uiSession: Pick<UiSessionFace, "adapter">
  readonly sessions: Observable<Pick<SessionListState, "phase">>
  readonly workspaces: Observable<Pick<WorkspaceSnapshot, "phase">>
}

export function watchMainBinding(sources: MainBindingSources): Observable<MainBinding> {
  return derive(
    [mainSession(sources.uiSession), sources.sessions, sources.workspaces],
    mainBindingOf,
    sameBinding,
  )
}
