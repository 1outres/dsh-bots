import {
  type BotChannelChange,
  type BotChannelDescriptor,
  type BotChannelPublicValues,
  type BotChannelView,
  emptyChannelValues,
  missingChannelFields,
  parseChannelChange,
} from "../../shared/channels"
import type { BotWelcomeChannelSetup } from "../../shared/onboarding"
import { createStore, type Observable } from "../observable"

/**
 * A channel's settings typed in the welcome guide before its bot exists: on
 * this page only, until the bot is created with them or the guide skips them.
 */
export interface ChannelDraft {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  /** The secrets typed, by key; they leave the page only with the creation. */
  readonly secrets: Readonly<Record<string, string>>
}

export const emptyDraft = (channel: BotChannelDescriptor): ChannelDraft => ({
  enabled: true,
  values: emptyChannelValues(channel.fields),
  secrets: {},
})

/** A change stored into a draft as the Host stores it into a bot's settings. */
export function withChange(draft: ChannelDraft, change: BotChannelChange): ChannelDraft {
  const secrets: Record<string, string> = { ...draft.secrets }
  for (const [key, edit] of Object.entries(change.secrets)) {
    if (edit.op === "set") secrets[key] = edit.value
    if (edit.op === "clear") delete secrets[key]
  }
  return { enabled: change.enabled, values: change.values, secrets }
}

const missingOf = (channel: BotChannelDescriptor, draft: ChannelDraft) =>
  missingChannelFields(channel.fields, draft.values, (key) => draft.secrets[key] !== undefined)

/** Whether the draft is on with every required field: it is set up with the bot. */
export const draftReady = (channel: BotChannelDescriptor, draft: ChannelDraft): boolean =>
  draft.enabled && missingOf(channel, draft).length === 0

/** The draft as the channel's group shows a bot's settings; a ready draft waits for its bot. */
export function draftView(channel: BotChannelDescriptor, draft: ChannelDraft): BotChannelView {
  const missing = missingOf(channel, draft)
  return {
    channel,
    enabled: draft.enabled,
    values: draft.values,
    secrets: Object.fromEntries(
      channel.fields
        .filter((field) => field.kind === "secret")
        .map((field) => [field.key, draft.secrets[field.key] !== undefined]),
    ),
    status: !draft.enabled
      ? { state: "off" }
      : missing.length > 0
        ? { state: "incomplete", missing }
        : { state: "waiting" },
  }
}

/** The setup a ready draft gives the creation. */
export const setupOf = (
  channel: BotChannelDescriptor,
  draft: ChannelDraft,
): BotWelcomeChannelSetup => ({
  channelId: channel.id,
  change: {
    enabled: true,
    values: draft.values,
    secrets: Object.fromEntries(
      Object.entries(draft.secrets).map(([key, value]) => [key, { op: "set", value }]),
    ),
  },
})

/** The drafts of one guide on this page, by channel id; an untouched channel has none. */
export interface ChannelDrafts extends Observable<ReadonlyMap<string, ChannelDraft>> {
  /** The channel's view, its draft or an empty one. */
  view(channel: BotChannelDescriptor): BotChannelView
  /** Check the change against the channel's fields, as the Host will, and keep it. @throws naming the problem. */
  configure(channel: BotChannelDescriptor, change: BotChannelChange): BotChannelView
  /** Whether any of `channels` is ready to be set up. */
  ready(channels: readonly BotChannelDescriptor[]): boolean
  /** The ready drafts of `channels` as the creation's setups. */
  setups(channels: readonly BotChannelDescriptor[]): BotWelcomeChannelSetup[]
  /** Drop every draft, secrets included. */
  clear(): void
}

export function createChannelDrafts(): ChannelDrafts {
  const drafts = createStore<ReadonlyMap<string, ChannelDraft>>(new Map())
  const draftOf = (channel: BotChannelDescriptor) =>
    drafts.getSnapshot().get(channel.id) ?? emptyDraft(channel)
  const readyOnes = (channels: readonly BotChannelDescriptor[]) =>
    channels.filter((channel) => draftReady(channel, draftOf(channel)))
  return {
    getSnapshot: drafts.getSnapshot,
    subscribe: drafts.subscribe,
    view: (channel) => draftView(channel, draftOf(channel)),
    configure(channel, change) {
      const next = withChange(draftOf(channel), parseChannelChange(channel.fields, change))
      drafts.update((current) => new Map(current).set(channel.id, next))
      return draftView(channel, next)
    },
    ready: (channels) => readyOnes(channels).length > 0,
    setups: (channels) => readyOnes(channels).map((channel) => setupOf(channel, draftOf(channel))),
    clear: () => drafts.set(new Map()),
  }
}
