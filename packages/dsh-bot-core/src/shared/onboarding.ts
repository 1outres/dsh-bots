import type { BotCreateInput } from "./bots"
import type { BotChannelChange, BotChannelDescriptor } from "./channels"
import type { ReleaseNote } from "./release-notes"

/**
 * The welcome guide of a new installation and the notes after an update
 * (docs/specs/bot-onboarding.md): what every page shows until one of them
 * finishes it, and the `botOnboarding` Remote.
 */

/** Where the welcome guide stands, as every page shows it. */
export type BotWelcomeView =
  /** Shown from the start. */
  | { readonly status: "open" }
  /** Its first bot is being created; every page shows the progress. */
  | { readonly status: "creating"; readonly botId: string }
  /** Finished; `botId` is the bot it created, if any. */
  | { readonly status: "done"; readonly botId?: string }

export interface BotOnboardingView {
  /** The dsh-bots version the Host runs. */
  readonly version: string
  readonly welcome: BotWelcomeView
  /** The notes not acknowledged yet, newest first; none to show when empty. */
  readonly releaseNotes: readonly ReleaseNote[]
  /** The channels the guide can set up for its bot: registered ones, while DSH's credential store is there. */
  readonly channels: readonly BotChannelDescriptor[]
}

/** A channel's settings for the guide's bot, stored with the `botChannels` checks right after the bot. */
export interface BotWelcomeChannelSetup {
  readonly channelId: string
  readonly change: BotChannelChange
}

/** Every `bot-onboarding/…` refusal of the `botOnboarding` Remote. */
export const BOT_ONBOARDING_ERROR_CODES = ["bot-onboarding/closed"] as const

export type BotOnboardingErrorCode = (typeof BOT_ONBOARDING_ERROR_CODES)[number]

/** The details each `bot-onboarding/…` refusal carries: none. */
export type BotOnboardingErrorDetails = {
  readonly [Code in BotOnboardingErrorCode]: Record<string, never>
}

/** The `botOnboarding` Remote. Every change is idempotent. */
export interface BotOnboardingApi {
  /** The view now and again after every change. */
  watch(signal?: AbortSignal): AsyncIterable<BotOnboardingView>
  /**
   * Create the guide's first bot exactly as `bots.create` does, store its
   * channels' settings, and show its progress on every page; the guide
   * finishes once the bot is listed. Every setup is checked before anything
   * is stored; when one cannot be stored, the bot is discarded.
   * @throws `bot-onboarding/closed` unless the guide is open (another page created one or finished it).
   */
  createBot(
    input: BotCreateInput,
    channels: readonly BotWelcomeChannelSetup[],
  ): Promise<{ readonly id: string }>
  /** Finish the guide without waiting: "later" while open, the bot being created otherwise. */
  finishWelcome(): Promise<BotOnboardingView>
  /** The newest version whose notes were shown has been read. */
  acknowledgeReleaseNotes(version: string): Promise<BotOnboardingView>
}
