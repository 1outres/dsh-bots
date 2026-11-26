import type { BotCreateInput } from "./bots"
import type { BotChannelChange, BotChannelDescriptor } from "./channels"
import type { ReleaseNote } from "./release-notes"

export type BotWelcomeView =
  | { readonly status: "open" }
  | { readonly status: "creating"; readonly botId: string }
  | { readonly status: "done"; readonly botId?: string }

export interface BotOnboardingView {
  readonly version: string
  readonly welcome: BotWelcomeView
  readonly releaseNotes: readonly ReleaseNote[]
  readonly channels: readonly BotChannelDescriptor[]
}

export interface BotWelcomeChannelSetup {
  readonly channelId: string
  readonly change: BotChannelChange
}

export const BOT_ONBOARDING_ERROR_CODES = ["bot-onboarding/closed"] as const

export type BotOnboardingErrorCode = (typeof BOT_ONBOARDING_ERROR_CODES)[number]

export type BotOnboardingErrorDetails = {
  readonly [Code in BotOnboardingErrorCode]: Record<string, never>
}

export interface BotOnboardingApi {
  watch(signal?: AbortSignal): AsyncIterable<BotOnboardingView>
  createBot(
    input: BotCreateInput,
    channels: readonly BotWelcomeChannelSetup[],
  ): Promise<{ readonly id: string }>
  finishWelcome(): Promise<BotOnboardingView>
  acknowledgeReleaseNotes(version: string): Promise<BotOnboardingView>
}
