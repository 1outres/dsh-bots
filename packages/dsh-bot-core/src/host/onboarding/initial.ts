import { compareVersions, NO_VERSION } from "../../shared/release-notes"
import type { OnboardingRecord } from "./domain"

export interface PriorInstallation {
  readonly bots: boolean
  readonly webSettings: boolean
  readonly oauthClients: boolean
}

export const isExisting = (prior: PriorInstallation): boolean =>
  prior.bots || prior.webSettings || prior.oauthClients

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

export function seenAfterAcknowledging(seen: string, shown: string, version: string): string {
  const upTo = compareVersions(shown, version) > 0 ? version : shown
  return compareVersions(upTo, seen) > 0 ? upTo : seen
}
