import { type LifecycleEvent, lifecycleEvents } from "../lifecycle"
import type { MainBinding } from "../main-session"
import type { NoticeStore } from "../notices"
import { createStore, type Observable, type Store } from "../observable"
import { type BotsState, snapshotOf } from "../session-classification"
import type { ClientContext } from "../types"

export interface LifecycleSources {
  readonly bots: Observable<BotsState>
  readonly binding: Observable<MainBinding>
  readonly progress: Store<string | null>
  readonly notices: NoticeStore
}

export const createProgressView = (): Store<string | null> => createStore<string | null>(null)

function react(
  ctx: ClientContext,
  event: LifecycleEvent,
  progress: Store<string | null>,
  notices: NoticeStore,
) {
  switch (event.kind) {
    case "created":
      notices.show({ kind: "created", name: event.bot.name })
      if (progress.getSnapshot() === event.bot.id) {
        progress.set(null)
        ctx.uiWorkspace.openSession(event.bot.mainSessionId)
      }
      break
    case "create-failed":
    case "remove-failed":
      notices.show({ kind: event.kind, name: event.pending.name })
      break
    case "gone":
      if (progress.getSnapshot() === event.id) progress.set(null)
      break
  }
}

export function wireLifecycle(ctx: ClientContext, sources: LifecycleSources): void {
  const { bots, binding, progress, notices } = sources
  ctx.effect(() => {
    let previous = snapshotOf(bots.getSnapshot())
    return bots.subscribe(() => {
      const next = snapshotOf(bots.getSnapshot())
      if (next === undefined || next === previous) return
      const events = previous === undefined ? [] : lifecycleEvents(previous, next)
      previous = next
      for (const event of events) react(ctx, event, progress, notices)
    })
  }, "bot-core: bot lifecycle")
  ctx.effect(() => binding.subscribe(() => progress.set(null)), "bot-core: progress view")
}
