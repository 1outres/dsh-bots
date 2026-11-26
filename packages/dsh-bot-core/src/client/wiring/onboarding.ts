import type { BotsSnapshot } from "../../shared/bots"
import type { BotWelcomeView } from "../../shared/onboarding"
import type { ChannelQueries } from "../channel-queries"
import type { ConnectionsFeed } from "../connections-model"
import type { CreationSources } from "../creation/use-creation-form"
import type { PendingActions } from "../face"
import { FORMAT_LOCALE_KEY } from "../locale-format"
import { derive, type Observable, type Store } from "../observable"
import { type OnboardingClient, watchOnboarding } from "../onboarding/client"
import { type OnboardingFace, OnboardingLayer } from "../onboarding/OnboardingLayer"
import { onboardingOverlay } from "../onboarding/steps"
import type { RemoteMount } from "../remote"
import { type BotsState, snapshotOf } from "../session-classification"
import type { ClientContext } from "../types"
import type { WebLookupFeed } from "../web/feed"
import { overlay } from "./dialogs"
import { NAMESPACE } from "./plugin"

export interface OnboardingSources {
  readonly remote: Promise<RemoteMount>
  readonly bots: Observable<BotsState>
  readonly progress: Store<string | null>
  readonly pending: PendingActions
  readonly creation: CreationSources
  readonly web: WebLookupFeed
  readonly connections: ConnectionsFeed
  readonly channelQueries: ChannelQueries
}

export type WelcomeLanding =
  | { readonly kind: "main"; readonly sessionId: string }
  | { readonly kind: "progress"; readonly botId: string }
  | null

export function welcomeLanding(
  welcome: Extract<BotWelcomeView, { readonly status: "done" }>,
  snapshot: BotsSnapshot | undefined,
): WelcomeLanding {
  if (welcome.botId === undefined) return null
  const bot = snapshot?.bots.find((listed) => listed.id === welcome.botId)
  return bot === undefined
    ? { kind: "progress", botId: welcome.botId }
    : { kind: "main", sessionId: bot.mainSessionId }
}

export function wireOnboarding(
  ctx: ClientContext,
  sources: OnboardingSources,
): Observable<boolean> {
  const onboarding: OnboardingClient = watchOnboarding({
    mount: sources.remote,
    generation: ctx.connection.generation,
    language: () => ctx.locale.bind(NAMESPACE)(FORMAT_LOCALE_KEY),
  })
  ctx.effect(() => () => onboarding.dispose(), "bot-core: onboarding")
  const text = (value: { readonly en: string; readonly ja?: string }) =>
    ctx.locale.resolveText({ ...value })
  overlay(
    ctx,
    "bot-core.onboarding",
    () =>
      ({
        onboarding,
        bots: sources.bots,
        pending: sources.pending,
        creation: sources.creation,
        web: sources.web,
        text,
        connections: sources.connections,
        channelQueries: sources.channelQueries,
      }) satisfies OnboardingFace,
    OnboardingLayer,
  )
  ctx.effect(() => {
    let shown = onboardingOverlay(onboarding.getSnapshot())?.kind === "welcome"
    return onboarding.subscribe(() => {
      const view = onboarding.getSnapshot()
      const showing = onboardingOverlay(view)?.kind === "welcome"
      if (shown && !showing && view?.welcome.status === "done") {
        const landing = welcomeLanding(view.welcome, snapshotOf(sources.bots.getSnapshot()))
        if (landing?.kind === "main") ctx.uiWorkspace.openSession(landing.sessionId)
        if (landing?.kind === "progress") sources.progress.set(landing.botId)
      }
      shown = showing
    })
  }, "bot-core: the welcome guide's landing")
  return derive([onboarding], (view) => onboardingOverlay(view) !== null)
}
