import type { BotChannel, BotChannelShared } from "../../channel-contract"
import {
  type BotChannelCheck,
  type BotChannelDefault,
  type BotChannelInitialSummary,
  type BotChannelInspection,
  type BotChannelOptions,
  type BotChannelPublicValues,
  type BotChannelSharedConfigureResult,
  type BotChannelSharedDescriptor,
  type BotChannelSharedSnapshot,
  type BotChannelSharedView,
  type BotChannelText,
  missingChannelFields,
  parseSharedChange,
  sourceOf,
  withSecretValues,
} from "../../shared/channels"
import type { SharedSettings } from "./shared-settings"

export interface SharedChannelPanelDeps {
  channels(): readonly BotChannel[]
  channel(id: string): BotChannel | undefined
  shared: Pick<SharedSettings, "view" | "status" | "resolve" | "preview" | "configure" | "revision">
  enabledBots(channelId: string): number
  synced(): void
  deadline(): AbortSignal
}

export type SharedChannel = BotChannel & { readonly shared: BotChannelShared }

export interface SharedChannelPanel {
  snapshot(): BotChannelSharedSnapshot
  configure(channelId: string, change: unknown): Promise<BotChannelSharedConfigureResult>
  defaults(): readonly BotChannelDefault[]
  ready(channel: BotChannel): boolean
  values(channel: BotChannel): Promise<BotChannelPublicValues>
  options(
    channel: SharedChannel,
    shared: BotChannelPublicValues,
    source: unknown,
    signal: AbortSignal,
  ): Promise<BotChannelOptions>
  inspect(
    channel: SharedChannel,
    shared: BotChannelPublicValues,
    signal: AbortSignal,
  ): Promise<BotChannelInspection>
  check(
    channel: SharedChannel,
    shared: BotChannelPublicValues,
    signal: AbortSignal,
  ): Promise<BotChannelCheck>
}

const FITS: BotChannelCheck = { ok: true }
const NOTHING_TO_INSPECT: BotChannelInspection = { state: "ready", links: [], warnings: [] }

export const unconfiguredReason = (channel: { readonly name: string }): BotChannelText => ({
  en: `Set up ${channel.name} in dsh-bots settings first.`,
  ja: `先に dsh-bots の設定で ${channel.name} を設定してください。`,
})

export const hasShared = (channel: BotChannel): channel is SharedChannel =>
  channel.shared !== undefined

export function sharedDescriptorOf(channel: SharedChannel): BotChannelSharedDescriptor {
  return {
    id: channel.id,
    name: channel.name,
    ...(channel.shared.description === undefined
      ? {}
      : { description: channel.shared.description }),
    fields: channel.shared.fields,
    initial: channel.initialSettings !== undefined,
  }
}

const complete = (channel: SharedChannel, values: BotChannelPublicValues) =>
  missingChannelFields(channel.shared.fields, values, (key) => values[key] !== "").length === 0

export function createSharedChannelPanel(deps: SharedChannelPanelDeps): SharedChannelPanel {
  const requireShared = (channelId: string): SharedChannel => {
    const channel = deps.channel(channelId)
    if (channel === undefined) throw new Error(`channel "${channelId}" is not registered`)
    if (!hasShared(channel)) throw new Error(`channel "${channelId}" has no shared settings`)
    return channel
  }

  const ready = (channel: BotChannel) =>
    !hasShared(channel) || deps.shared.status(channel).state === "ready"

  const initialOf = (channel: SharedChannel): BotChannelInitialSummary | undefined => {
    const describe = channel.shared.describeInitial
    if (describe === undefined || !ready(channel)) return undefined
    const current = deps.shared.view(channel)
    return describe(withSecretValues(channel.shared.fields, current.values, {}) as never)
  }

  const view = (channel: SharedChannel): BotChannelSharedView => {
    const current = deps.shared.view(channel)
    const initial = initialOf(channel)
    return {
      channel: sharedDescriptorOf(channel),
      ...current,
      ...(initial === undefined ? {} : { initial }),
      status: deps.shared.status(channel),
      enabledBots: deps.enabledBots(channel.id),
      revision: deps.shared.revision(channel.id),
    }
  }

  const checkOf = (channel: SharedChannel, shared: BotChannelPublicValues, signal: AbortSignal) =>
    channel.shared.check === undefined || !complete(channel, shared)
      ? Promise.resolve(FITS)
      : channel.shared.check({ shared: shared as never, signal })

  return {
    snapshot: () => ({ channels: deps.channels().filter(hasShared).map(view) }),
    async configure(channelId, input) {
      const channel = requireShared(channelId)
      const change = parseSharedChange(channel.shared.fields, input)
      if (change.newBots && channel.initialSettings === undefined) {
        throw new Error(`channel "${channelId}" does not set itself up for new bots`)
      }
      const preview = await deps.shared.preview(channel, change)
      const checked = await checkOf(channel, preview, deps.deadline())
      if (!checked.ok) return { saved: false, reason: checked.reason }
      await deps.shared.configure(channel, change)
      deps.synced()
      return { saved: true, view: view(channel) }
    },
    defaults() {
      return deps.channels().flatMap((channel): BotChannelDefault[] => {
        if (!hasShared(channel) || !deps.shared.view(channel).newBots) return []
        const initial = initialOf(channel)
        return initial === undefined
          ? [
              {
                channelId: channel.id,
                name: channel.name,
                initial: { state: "unavailable", reason: unconfiguredReason(channel) },
              },
            ]
          : [{ channelId: channel.id, name: channel.name, initial }]
      })
    },
    ready,
    values: (channel) => (hasShared(channel) ? deps.shared.resolve(channel) : Promise.resolve({})),
    async options(channel, shared, source, signal) {
      const { options } = channel.shared
      if (
        typeof source !== "string" ||
        options === undefined ||
        !channel.shared.fields.some((field) => sourceOf(field) === source)
      ) {
        throw new Error(
          `the shared settings of "${channel.id}" have no source ${JSON.stringify(source)}`,
        )
      }
      return options({ shared: shared as never, source, signal })
    },
    inspect: (channel, shared, signal) =>
      channel.shared.inspect === undefined
        ? Promise.resolve(NOTHING_TO_INSPECT)
        : channel.shared.inspect({ shared: shared as never, signal }),
    check: checkOf,
  }
}
