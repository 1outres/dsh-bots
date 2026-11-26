import type { BotChannelShared } from "../../channel-contract"
import {
  type BotChannelPublicValues,
  type BotChannelSharedChange,
  type BotChannelSharedStatus,
  channelValuesOf,
  secretFlagsOf,
  secretsAfterChange,
  sharedChannelStatus,
  withSecretValues,
} from "../../shared/channels"
import type { BotTable } from "../registry"
import type { SharedChannelRecord } from "./domain"
import type { SharedSecretVault } from "./vault"

export interface SharedSettingsDeps {
  shared: BotTable<SharedChannelRecord>
  vault: SharedSecretVault
  now(): number
  warn(message: string): void
}

export interface SharedChannel {
  readonly id: string
  readonly shared: Pick<BotChannelShared, "fields" | "settingsVersion" | "upgradeSettings">
}

export interface SharedSettingsView {
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
  readonly newBots: boolean
}

export interface SharedSettings {
  view(channel: SharedChannel): SharedSettingsView
  status(channel: SharedChannel): BotChannelSharedStatus
  revision(channelId: string): number
  configure(channel: SharedChannel, change: BotChannelSharedChange): Promise<void>
  resolve(channel: SharedChannel): Promise<BotChannelPublicValues>
  preview(channel: SharedChannel, change: BotChannelSharedChange): Promise<BotChannelPublicValues>
  upgrade(channel: SharedChannel): Promise<void>
  subscribe(listener: (channelId: string) => void): () => void
}

const versionOf = (channel: SharedChannel) => channel.shared.settingsVersion ?? 1

function currentValues(
  record: SharedChannelRecord,
  channel: SharedChannel,
): { readonly values: BotChannelPublicValues; readonly notes: readonly string[] } | undefined {
  const from = record.settingsVersion ?? 1
  const current = versionOf(channel)
  if (from > current) return undefined
  if (from === current || channel.shared.upgradeSettings === undefined) {
    return { values: record.values, notes: [] }
  }
  return channel.shared.upgradeSettings({ version: from, values: record.values })
}

export function createSharedSettings(deps: SharedSettingsDeps): SharedSettings {
  const listeners = new Set<(channelId: string) => void>()
  const revisions = new Map<string, number>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (channelId: string) => {
    revisions.set(channelId, (revisions.get(channelId) ?? 0) + 1)
    for (const listener of [...listeners]) listener(channelId)
  }

  const stored = (channel: SharedChannel) => {
    const record = deps.shared.get(channel.id)
    if (record === undefined) return undefined
    const current = currentValues(record, channel)
    return current === undefined ? undefined : { record, values: current.values }
  }

  const view = (channel: SharedChannel): SharedSettingsView => {
    const found = stored(channel)
    const secrets = new Set(found?.record.secrets ?? [])
    return {
      values: channelValuesOf(channel.shared.fields, found?.values ?? {}),
      secrets: secretFlagsOf(channel.shared.fields, (key) => secrets.has(key)),
      newBots: found?.record.newBots ?? false,
    }
  }

  const store = (
    channel: SharedChannel,
    next: {
      readonly values: BotChannelPublicValues
      readonly secrets: readonly string[]
      readonly newBots: boolean
    },
  ) =>
    deps.shared.put(channel.id, {
      channelId: channel.id,
      values: channelValuesOf(channel.shared.fields, next.values) as SharedChannelRecord["values"],
      secrets: [...next.secrets].sort(),
      newBots: next.newBots,
      settingsVersion: versionOf(channel),
      updatedAt: deps.now(),
    })

  return {
    view,
    status(channel) {
      const current = view(channel)
      return sharedChannelStatus(channel.shared.fields, current.values, current.secrets)
    },
    revision: (channelId) => revisions.get(channelId) ?? 0,
    configure(channel, change) {
      return serial(async () => {
        const before = await deps.vault.read(channel.id)
        const secrets = secretsAfterChange(channel.shared.fields, before, change.secrets)
        const secretsChanged =
          Object.keys(before).length !== Object.keys(secrets).length ||
          Object.entries(secrets).some(([key, value]) => before[key] !== value)
        if (secretsChanged) await deps.vault.write(channel.id, secrets)
        await store(channel, {
          values: change.values,
          secrets: Object.keys(secrets),
          newBots: change.newBots,
        })
        changed(channel.id)
      })
    },
    async resolve(channel) {
      const current = view(channel)
      const secrets = await deps.vault.read(channel.id)
      for (const field of channel.shared.fields) {
        if (
          field.kind === "secret" &&
          current.secrets[field.key] === true &&
          secrets[field.key] === undefined
        ) {
          throw new Error(
            `the stored ${field.key} of channel "${channel.id}" is missing from DSH's credential store; set it again in dsh-bots settings`,
          )
        }
      }
      return withSecretValues(channel.shared.fields, current.values, secrets)
    },
    async preview(channel, change) {
      const before = await deps.vault.read(channel.id)
      return withSecretValues(
        channel.shared.fields,
        change.values,
        secretsAfterChange(channel.shared.fields, before, change.secrets),
      )
    },
    upgrade(channel) {
      return serial(async () => {
        const record = deps.shared.get(channel.id)
        if (record === undefined || (record.settingsVersion ?? 1) >= versionOf(channel)) return
        const current = currentValues(record, channel)
        if (current === undefined) return
        for (const note of current.notes) {
          deps.warn(
            `bot-core: shared settings of channel "${channel.id}" upgraded to version ${versionOf(channel)}: ${note}`,
          )
        }
        await store(channel, { ...record, values: current.values })
        changed(channel.id)
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
