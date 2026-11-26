import type { BotChannelText } from "../../shared/channels"
import { type BotManagedSessionsSnapshot, managedSessionOf } from "../../shared/managed-sessions"
import type { ComposerChainOwner } from "../dsh/conversation"
import { SLOT } from "../dsh/slots"
import {
  INTERACTION_PRECEDENCE,
  type InteractionCarrier,
  isInteractionCarrier,
  publishCarriers,
} from "../interactions/carrier"
import {
  InteractionComposer,
  type InteractionComposerFace,
} from "../interactions/InteractionComposer"
import { followSessionInteractions, type SessionInteractions } from "../interactions/session"
import { mainSession } from "../main-session"
import { derive, type Observable } from "../observable"
import type { RemoteMount } from "../remote"
import { BOT_SESSION_PRIORITY } from "../slot-priority"
import type { ClientContext } from "../types"
import type { Classification } from "./classification"
import { NAMESPACE } from "./plugin"

export interface InteractionSources {
  readonly remote: Promise<RemoteMount>
  readonly classification: Classification
  readonly managed: Observable<BotManagedSessionsSnapshot>
}

export function wireInteractions(ctx: ClientContext, sources: InteractionSources): void {
  const shown = derive(
    [mainSession(ctx.uiSession), sources.classification.main, sources.managed],
    (sessionId, session, managed) =>
      session.kind === "bot" ||
      (sessionId !== undefined && managedSessionOf(managed, sessionId)?.target.kind === "workspace")
        ? sessionId
        : undefined,
  )
  const followed = followShown(shown, (sessionId) =>
    followSessionInteractions(
      { mount: sources.remote, generation: ctx.connection.generation, now: Date.now },
      sessionId,
    ),
  )
  ctx.effect(() => followed.dispose, "bot-core: interactions of the shown bot session")
  const publish = ctx.uiSession.registerPendingInteraction<InteractionCarrier>(
    () => INTERACTION_PRECEDENCE,
  )
  ctx.effect(() => publishCarriers(followed, publish), "bot-core: interaction carriers")
  const face: InteractionComposerFace = {
    interactionsOf: (sessionId) => {
      const model = followed.getSnapshot()
      return model?.sessionId === sessionId ? model : undefined
    },
    text: (text: BotChannelText) => ctx.locale.resolveText(text),
  }
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.conversationComposer, () =>
        ctx.slots.register(
          {
            name: SLOT.conversationComposer,
            priority: BOT_SESSION_PRIORITY,
            select: ({ pendingInteraction }: ComposerChainOwner) =>
              isInteractionCarrier(pendingInteraction) ? pendingInteraction : null,
            locale: NAMESPACE,
            inject: () => face,
          },
          InteractionComposer,
        ),
      ),
    "bot-core: interaction cards",
  )
}

function followShown(
  shown: Observable<string | undefined>,
  follow: (sessionId: string) => SessionInteractions,
): Observable<SessionInteractions | undefined> & { dispose(): void } {
  let model: SessionInteractions | undefined
  const listeners = new Set<() => void>()
  const sync = () => {
    const sessionId = shown.getSnapshot()
    if (model?.sessionId === sessionId) return
    model?.dispose()
    model = sessionId === undefined ? undefined : follow(sessionId)
    for (const listener of [...listeners]) listener()
  }
  sync()
  const off = shown.subscribe(sync)
  return {
    getSnapshot: () => model,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      off()
      model?.dispose()
      model = undefined
    },
  }
}
