import type { BotsSnapshot } from "../../shared/bots"
import type { BotChannelDescriptor } from "../../shared/channels"
import type { BotOnboardingView, BotWelcomeView } from "../../shared/onboarding"
import { dueBetween, type ReleaseNote } from "../../shared/release-notes"
import type { OnboardingRecord, WelcomeRecord } from "./domain"
import { seenAfterAcknowledging } from "./initial"

/** The guide's first bot is being created. Only from `open`. */
export function tracking(record: OnboardingRecord, botId: string, now: number): OnboardingRecord {
  if (record.welcome.status !== "open") return record
  return { ...record, welcome: { status: "creating", botId, startedAt: now }, updatedAt: now }
}

/** "Later": an open guide is done without a bot, a creating one with the bot it is creating. */
export function finishing(record: OnboardingRecord, now: number): OnboardingRecord {
  const { welcome } = record
  switch (welcome.status) {
    case "done":
      return record
    case "open":
      return { ...record, welcome: { status: "done", at: now, how: "later" }, updatedAt: now }
    case "creating":
      return {
        ...record,
        welcome: { status: "done", at: now, how: "created", botId: welcome.botId },
        updatedAt: now,
      }
  }
}

/**
 * Where a creating guide goes with the bots as they are: done once its bot
 * is listed, open again once the bot is neither listed nor pending (it was
 * discarded). A failed creation stays, to be retried or discarded.
 */
export function welcomeAfter(
  welcome: WelcomeRecord,
  snapshot: Pick<BotsSnapshot, "bots" | "pending">,
  now: number,
): WelcomeRecord {
  if (welcome.status !== "creating") return welcome
  const { botId } = welcome
  if (snapshot.bots.some((bot) => bot.id === botId)) {
    return { status: "done", at: now, how: "created", botId }
  }
  if (snapshot.pending.some((pending) => pending.id === botId)) return welcome
  return { status: "open" }
}

export function acknowledging(
  record: OnboardingRecord,
  shown: string,
  version: string,
  now: number,
): OnboardingRecord {
  const notesSeen = seenAfterAcknowledging(record.notesSeen, shown, version)
  return notesSeen === record.notesSeen ? record : { ...record, notesSeen, updatedAt: now }
}

function welcomeView(welcome: WelcomeRecord): BotWelcomeView {
  switch (welcome.status) {
    case "open":
      return { status: "open" }
    case "creating":
      return { status: "creating", botId: welcome.botId }
    case "done":
      return welcome.botId === undefined
        ? { status: "done" }
        : { status: "done", botId: welcome.botId }
  }
}

export function onboardingView(
  record: OnboardingRecord,
  /** The notes read so far, newest first; those not seen yet are shown. */
  notes: readonly ReleaseNote[],
  version: string,
  channels: readonly BotChannelDescriptor[],
): BotOnboardingView {
  return {
    version,
    welcome: welcomeView(record.welcome),
    releaseNotes: notes.filter((note) => dueBetween(note.version, record.notesSeen, version)),
    channels,
  }
}
