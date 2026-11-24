import { type MainBinding, watchMainBinding } from "../main-session"
import { derive, type Observable } from "../observable"
import {
  type BotsState,
  createSessionClassifier,
  type SessionClassifier,
} from "../session-classification"
import type { ClientContext } from "../types"

export interface Classification extends SessionClassifier {
  /** What the main view is bound to. */
  readonly binding: Observable<MainBinding>
  /**
   * Whether bot-core holds the main view's single Slots: for a bot session,
   * for one not classified yet, so DSH's own UI never shows before it is
   * known, and while a bot's creation progress is shown.
   */
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
