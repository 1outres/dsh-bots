import type { BotChannelDescriptor } from "../../shared/channels"
import type { BotOnboardingView, BotWelcomeView } from "../../shared/onboarding"
import type { ReleaseNote } from "../../shared/release-notes"

export type ShownWelcome = Exclude<BotWelcomeView, { readonly status: "done" }>

export type OnboardingOverlay =
  | {
      readonly kind: "welcome"
      readonly welcome: ShownWelcome
      readonly channels: readonly BotChannelDescriptor[]
    }
  | { readonly kind: "release-notes"; readonly notes: readonly ReleaseNote[] }
  | null

export function onboardingOverlay(view: BotOnboardingView | undefined): OnboardingOverlay {
  if (view === undefined) return null
  if (view.welcome.status !== "done") {
    return { kind: "welcome", welcome: view.welcome, channels: view.channels }
  }
  return view.releaseNotes.length > 0 ? { kind: "release-notes", notes: view.releaseNotes } : null
}

export const WIZARD_STEPS = ["welcome", "web", "accounts", "channels", "bot"] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export interface SetupAvailability {
  readonly web: boolean
  readonly accounts: boolean
  readonly channels: boolean
}

const SETUP: { readonly [Step in WizardStep]?: keyof SetupAvailability } = {
  web: "web",
  accounts: "accounts",
  channels: "channels",
}

export function wizardSteps(available: SetupAvailability): WizardStep[] {
  return WIZARD_STEPS.filter((step) => {
    const needs = SETUP[step]
    return needs === undefined || available[needs]
  })
}

export function positionOf(steps: readonly WizardStep[], step: WizardStep): number {
  const wanted = WIZARD_STEPS.indexOf(step)
  const at = steps.findIndex((shown) => WIZARD_STEPS.indexOf(shown) >= wanted)
  return at === -1 ? steps.length - 1 : at
}
