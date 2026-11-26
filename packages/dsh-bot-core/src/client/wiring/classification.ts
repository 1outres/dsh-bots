import { type MainBinding, watchMainBinding } from "../main-session"
import { derive, type Observable } from "../observable"
import {
  type BotsState,
  createSessionClassifier,
  type SessionClassifier,
} from "../session-classification"
import type { ClientContext } from "../types"

export interface Classification extends SessionClassifier {
  readonly binding: Observable<MainBinding>
  readonly occupies: Observable<boolean>
}

export function wireClassification(
  ctx: ClientContext,
  bots: Observable<BotsState>,
  progress: Observable<string | null>,
): Classification {
  const binding = watchMainBinding({
    uiSession: ctx.uiSession,
    sessions: ctx.sessions.list,
    workspaces: ctx.workspaces.list,
  })
  const classifier = createSessionClassifier({ main: binding, bots, sessions: ctx.sessions.list })
  return {
    ...classifier,
    binding,
    occupies: derive(
      [classifier.main, progress],
      (session, shown) => session.kind !== "stock" || shown !== null,
    ),
  }
}
