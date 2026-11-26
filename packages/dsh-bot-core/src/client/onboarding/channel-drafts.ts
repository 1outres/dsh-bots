import {
  type BotChannelChange,
  type BotChannelDescriptor,
  type BotChannelPublicValues,
  type BotChannelSettingsRef,
  type BotChannelView,
  emptyChannelValues,
  missingChannelFields,
  parseChannelChange,
} from "../../shared/channels"
import type { BotWelcomeChannelSetup } from "../../shared/onboarding"
import { askAbout, type ChannelAsk, type ChannelQueries } from "../channel-queries"
import { ChannelsError, checkFailure } from "../channels-model"
import { createStore, type Observable } from "../observable"

export interface ChannelDraft {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, string>>
  readonly revision: number
}

export const emptyDraft = (channel: BotChannelDescriptor): ChannelDraft => ({
  enabled: true,
  values: emptyChannelValues(channel.fields),
  secrets: {},
  revision: 0,
})

export function withChange(draft: ChannelDraft, change: BotChannelChange): ChannelDraft {
  const secrets: Record<string, string> = { ...draft.secrets }
  for (const [key, edit] of Object.entries(change.secrets)) {
    if (edit.op === "set") secrets[key] = edit.value
    if (edit.op === "clear") delete secrets[key]
  }
  return { enabled: change.enabled, values: change.values, secrets, revision: draft.revision + 1 }
}

const missingOf = (channel: BotChannelDescriptor, draft: ChannelDraft) =>
  missingChannelFields(channel.fields, draft.values, (key) => draft.secrets[key] !== undefined)

export const draftReady = (channel: BotChannelDescriptor, draft: ChannelDraft): boolean =>
  draft.enabled && missingOf(channel, draft).length === 0

export const draftRef = (draft: ChannelDraft): BotChannelSettingsRef => ({
  kind: "draft",
  values: draft.values,
  secrets: draft.secrets,
})

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
    revision: draft.revision,
  }
}

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

export interface ChannelDrafts extends Observable<ReadonlyMap<string, ChannelDraft>> {
  view(channel: BotChannelDescriptor): BotChannelView
  configure(channel: BotChannelDescriptor, change: BotChannelChange): Promise<BotChannelView>
  ask(channel: BotChannelDescriptor): ChannelAsk
  ready(channels: readonly BotChannelDescriptor[]): boolean
  setups(channels: readonly BotChannelDescriptor[]): BotWelcomeChannelSetup[]
  clear(): void
}

const CHECK_MS = 20_000

export function createChannelDrafts(queries: ChannelQueries): ChannelDrafts {
  const drafts = createStore<ReadonlyMap<string, ChannelDraft>>(new Map())
  const draftOf = (channel: BotChannelDescriptor) =>
    drafts.getSnapshot().get(channel.id) ?? emptyDraft(channel)
  const readyOnes = (channels: readonly BotChannelDescriptor[]) =>
    channels.filter((channel) => draftReady(channel, draftOf(channel)))
  return {
    getSnapshot: drafts.getSnapshot,
    subscribe: drafts.subscribe,
    view: (channel) => draftView(channel, draftOf(channel)),
    async configure(channel, change) {
      const next = withChange(draftOf(channel), parseChannelChange(channel.fields, change))
      if (draftReady(channel, next)) {
        const checked = await queries.check(
          channel.id,
          draftRef(next),
          AbortSignal.timeout(CHECK_MS),
        )
        if (!checked.ok) throw new ChannelsError(checkFailure(checked.reason))
      }
      drafts.update((current) => new Map(current).set(channel.id, next))
      return draftView(channel, next)
    },
    ask: (channel) => askAbout(queries, channel.id, () => draftRef(draftOf(channel))),
    ready: (channels) => readyOnes(channels).length > 0,
    setups: (channels) => readyOnes(channels).map((channel) => setupOf(channel, draftOf(channel))),
    clear: () => drafts.set(new Map()),
  }
}
