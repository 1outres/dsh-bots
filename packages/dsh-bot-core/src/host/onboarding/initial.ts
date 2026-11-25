import { compareVersions, NO_VERSION } from "../../shared/release-notes"
import type { OnboardingRecord } from "./domain"

/** What bot-core finds stored on its first start with onboarding: whether it ran here before. */
export interface PriorInstallation {
  /** Bots stored, listed or not. */
  readonly bots: boolean
  /** The web lookup settings were stored by an earlier start. */
  readonly webSettings: boolean
  /** An OAuth client is stored. */
  readonly oauthClients: boolean
}

export const isExisting = (prior: PriorInstallation): boolean =>
  prior.bots || prior.webSettings || prior.oauthClients

/** The record of a first start: an existing installation sees the notes up to now, a new one the guide. */
export function initialRecord(
  prior: PriorInstallation,
  version: string,
  now: number,
): OnboardingRecord {
  return isExisting(prior)
    ? {
        welcome: { status: "done", at: now, how: "existing" },
        notesSeen: NO_VERSION,
        updatedAt: now,
      }
    : { welcome: { status: "open" }, notesSeen: version, updatedAt: now }
}

/** `notesSeen` after the notes up to `shown` were acknowledged: never back, never past `version`. */
export function seenAfterAcknowledging(seen: string, shown: string, version: string): string {
  const upTo = compareVersions(shown, version) > 0 ? version : shown
  return compareVersions(upTo, seen) > 0 ? upTo : seen
}
