import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type { BotCreateInput } from "../../shared/bots"
import type {
  BotOnboardingErrorCode,
  BotOnboardingErrorDetails,
  BotOnboardingView,
} from "../../shared/onboarding"
import { isVersion } from "../../shared/release-notes"
import type { WelcomeChannelSetup, WelcomeChannels } from "./channels"
import type { ReleaseNotesKeeper } from "./notes"
import type { OnboardingStore } from "./store"
import { acknowledging, finishing, onboardingView, tracking } from "./welcome"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotOnboardingErrorDetails {}
}

/** What the `botOnboarding` Remote serves. */
export interface OnboardingPanel {
  view(): BotOnboardingView
  createBot(input: BotCreateInput, channels: unknown): Promise<{ readonly id: string }>
  finishWelcome(): Promise<BotOnboardingView>
  acknowledgeReleaseNotes(version: unknown): Promise<BotOnboardingView>
  subscribe(listener: () => void): () => void
}

export interface OnboardingPanelDeps {
  readonly store: OnboardingStore
  readonly version: string
  readonly notes: Pick<ReleaseNotesKeeper, "notes" | "subscribe">
  readonly channels: Pick<WelcomeChannels, "descriptors" | "parse" | "apply" | "subscribe">
  /** `bots.create`'s creation: resolves with the new bot's id once it is stored. */
  create(input: BotCreateInput): Promise<string>
  /** `bots.discardCreate`: give up a creation, the bot removed like a deleted one. */
  discard(botId: string): Promise<void>
  now(): number
}

const refuse = (code: BotOnboardingErrorCode, message: string) => new RemoteError(code, message, {})
const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createOnboardingPanel(deps: OnboardingPanelDeps): OnboardingPanel {
  const { store, version, notes, channels } = deps
  const view = () => onboardingView(store.current(), notes.notes(), version, channels.descriptors())
  const parseSetups = (input: unknown): readonly WelcomeChannelSetup[] => {
    try {
      return channels.parse(input)
    } catch (error) {
      throw bad(messageOf(error))
    }
  }
  /** The bot with its channels, or none of it: a setup that cannot be stored discards the bot. */
  const createWith = async (input: BotCreateInput, setups: readonly WelcomeChannelSetup[]) => {
    const id = await deps.create(input)
    try {
      await channels.apply(id, setups)
    } catch (error) {
      await deps.discard(id)
      throw error
    }
    return id
  }
  return {
    view,
    async createBot(input, channelsInput) {
      const setups = parseSetups(channelsInput)
      const record = await store.change(async (current) => {
        if (current.welcome.status !== "open") {
          throw refuse(
            "bot-onboarding/closed",
            "the welcome guide has already created a bot or finished",
          )
        }
        return tracking(current, await createWith(input, setups), deps.now())
      })
      if (record.welcome.status !== "creating") throw new Error("the welcome guide is not creating")
      return { id: record.welcome.botId }
    },
    async finishWelcome() {
      await store.change((current) => finishing(current, deps.now()))
      return view()
    },
    async acknowledgeReleaseNotes(shown) {
      if (!isVersion(shown)) throw bad("version must be a MAJOR.MINOR.PATCH version")
      await store.change((current) => acknowledging(current, shown, version, deps.now()))
      return view()
    },
    subscribe(listener) {
      const offs = [
        store.subscribe(listener),
        notes.subscribe(listener),
        channels.subscribe(listener),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
