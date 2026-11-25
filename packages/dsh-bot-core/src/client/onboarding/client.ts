import type { BotOnboardingView, BotWelcomeChannelSetup } from "../../shared/onboarding"
import { followStream } from "../approvals/follow"
import { type BotCreationRequest, createdBotId, creationInput } from "../creation/request"
import { createStore, type Observable } from "../observable"
import type { BotOnboardingRemote, RemoteMount } from "../remote"
import type { RemoteResult } from "../types"

/**
 * The welcome guide and the release notes as the Host keeps them, followed
 * while the page is open (undefined until the first view; the last one stays
 * while it reconnects), and the changes the page asks for.
 */
export interface OnboardingClient extends Observable<BotOnboardingView | undefined> {
  /** Resolves with the new bot's id; a refused model rejects with a `ModelsError`, anything else with the Host's message. */
  createBot(
    request: BotCreationRequest,
    channels: readonly BotWelcomeChannelSetup[],
  ): Promise<string>
  /** Rejects with the Host's message. */
  finishWelcome(): Promise<void>
  /** Rejects with the Host's message. */
  acknowledgeReleaseNotes(version: string): Promise<void>
  dispose(): void
}

export interface OnboardingClientSources {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
  /** The language bot-core is shown in, which a new bot greets in. */
  language(): string
}

export function watchOnboarding(sources: OnboardingClientSources): OnboardingClient {
  const state = createStore<BotOnboardingView | undefined>(undefined)
  let disposed = false
  let stop: (() => void) | undefined
  const face = sources.mount.then((mounted) => {
    if (mounted.status === "failed") throw new Error(mounted.error)
    return mounted.remote.botOnboarding
  })
  void face.then(
    (remote) => {
      if (disposed) return
      stop = followStream({
        generation: sources.generation,
        open: () => remote.watch(),
        item: (view: BotOnboardingView) => state.set(view),
        lost: () => {},
      })
    },
    () => {},
  )
  const call = async <T>(request: (remote: BotOnboardingRemote) => Promise<RemoteResult<T>>) => {
    const result = await request(await face)
    if (!result.ok) throw new Error(result.error.message ?? "request refused")
    return result.value
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    createBot: async (request, channels) =>
      createdBotId(
        await (await face).createBot(creationInput(request, sources.language()), channels),
      ),
    finishWelcome: async () => {
      state.set(await call((remote) => remote.finishWelcome()))
    },
    acknowledgeReleaseNotes: async (version) => {
      state.set(await call((remote) => remote.acknowledgeReleaseNotes(version)))
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
