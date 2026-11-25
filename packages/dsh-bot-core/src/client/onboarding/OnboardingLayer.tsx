import { useObservable } from "../hooks"
import type { Translate } from "../types"
import type { OnboardingClient } from "./client"
import { ReleaseNotesDialog } from "./ReleaseNotes"
import { onboardingOverlay } from "./steps"
import { WelcomeGuide, type WelcomeSources } from "./Welcome"

/** What bot-core's onboarding overlay registration injects. */
export interface OnboardingFace extends Omit<WelcomeSources, "onboarding"> {
  readonly onboarding: OnboardingClient
}

/** The welcome guide, or else the release notes, while the Host says one of them waits. */
export function OnboardingLayer(props: OnboardingFace & { readonly t: Translate }) {
  const overlay = onboardingOverlay(useObservable(props.onboarding))
  if (overlay === null) return null
  return overlay.kind === "welcome" ? (
    <WelcomeGuide {...props} welcome={overlay.welcome} channels={overlay.channels} />
  ) : (
    <ReleaseNotesDialog t={props.t} notes={overlay.notes} onboarding={props.onboarding} />
  )
}
