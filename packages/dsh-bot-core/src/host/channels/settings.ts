import type { BotChannel } from "../../contract"
import {
  type BotChannelChange,
  type BotChannelInitialFailure,
  type BotChannelPublicValues,
  channelValuesOf,
  missingChannelFields,
  secretsAfterChange,
  withSecretValues,
} from "../../shared/channels"
import type { BotTable } from "../registry"
import { settingsVersionOf } from "./catalog"
import { type ChannelRecord, channelRecordKey } from "./domain"
import type { SecretVault } from "./vault"

export interface ChannelSettingsDeps {
  records: BotTable<ChannelRecord>
  vault: SecretVault
  now(): number
  warn(message: string): void
}

export type SettingsChannel = Pick<
  BotChannel,
  "id" | "fields" | "settingsVersion" | "upgradeSettings"
>

export interface ChannelSettingsView {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
  readonly profileSync: boolean
  readonly initial?: BotChannelInitialFailure
}

export type ChannelReadiness =
  | { readonly state: "off" }
  | { readonly state: "incomplete"; readonly missing: readonly string[] }
  | { readonly state: "ready" }

export interface ChannelSettings {
  view(botId: string, channel: SettingsChannel): ChannelSettingsView
  readiness(botId: string, channel: SettingsChannel): ChannelReadiness
  revision(botId: string, channelId: string): number
  configure(botId: string, channel: SettingsChannel, change: BotChannelChange): Promise<void>
  resolve(botId: string, channel: SettingsChannel): Promise<BotChannelPublicValues>
  preview(
    botId: string,
    channel: SettingsChannel,
    change: BotChannelChange,
  ): Promise<BotChannelPublicValues>
  markInitialFailed(
    botId: string,
    channel: SettingsChannel,
    failure: BotChannelInitialFailure,
  ): Promise<void>
  upgrade(channel: SettingsChannel): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string, channelId: string) => void): () => void
}

type Upgraded =
  | {
      readonly state: "current"
      readonly values: BotChannelPublicValues
      readonly notes: readonly string[]
    }
  | { readonly state: "newer" }

function upgradedOf(record: ChannelRecord, channel: SettingsChannel): Upgraded {
  const from = record.settingsVersion ?? 1
  const current = settingsVersionOf(channel)
  if (from > current) return { state: "newer" }
  if (from === current || channel.upgradeSettings === undefined) {
    return { state: "current", values: record.values, notes: [] }
  }
  const upgrade = channel.upgradeSettings({ version: from, values: record.values })
  return { state: "current", values: upgrade.values, notes: upgrade.notes }
}

export function createChannelSettings(deps: ChannelSettingsDeps): ChannelSettings {
  const listeners = new Set<(botId: string, channelId: string) => void>()
  const revisions = new Map<string, number>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (botId: string, channelId: string, reconnect: boolean) => {
    if (reconnect) {
      const key = channelRecordKey(botId, channelId)
      revisions.set(key, (revisions.get(key) ?? 0) + 1)
    }
    for (const listener of [...listeners]) listener(botId, channelId)
  }

  const storedOf = (botId: string, channel: SettingsChannel) => {
    const record = deps.records.get(channelRecordKey(botId, channel.id))
    if (record === undefined) return undefined
    const upgraded = upgradedOf(record, channel)
    return upgraded.state === "newer" ? undefined : { record, values: upgraded.values }
  }

  const view = (botId: string, channel: SettingsChannel): ChannelSettingsView => {
    const stored = storedOf(botId, channel)
    const secrets = new Set(stored?.record.secrets ?? [])
    const initial = stored?.record.initial
    return {
      enabled: stored?.record.enabled ?? false,
      profileSync: stored?.record.profileSync === true,
      ...(initial === undefined ? {} : { initial }),
      values: channelValuesOf(channel.fields, stored?.values ?? {}),
      secrets: Object.fromEntries(
        channel.fields
          .filter((field) => field.kind === "secret")
          .map((field) => [field.key, secrets.has(field.key)]),
      ),
    }
  }

  const secretsAfter = (
    stored: Readonly<Record<string, string>>,
    channel: SettingsChannel,
    change: BotChannelChange,
  ) => secretsAfterChange(channel.fields, stored, change.secrets)

  const withSecrets = (
    channel: SettingsChannel,
    values: BotChannelPublicValues,
    secrets: Readonly<Record<string, string>>,
  ) => withSecretValues(channel.fields, values, secrets)

  const store = async (
    botId: string,
    channel: SettingsChannel,
    stored: {
      readonly enabled: boolean
      readonly values: BotChannelPublicValues
      readonly secrets: readonly string[]
      readonly profileSync?: boolean
      readonly initial?: BotChannelInitialFailure
    },
  ) => {
    await deps.records.put(channelRecordKey(botId, channel.id), {
      botId,
      channelId: channel.id,
      enabled: stored.enabled,
      values: channelValuesOf(channel.fields, stored.values) as ChannelRecord["values"],
      secrets: [...stored.secrets].sort(),
      settingsVersion: settingsVersionOf(channel),
      profileSync: stored.profileSync === true,
      ...(stored.initial === undefined ? {} : { initial: stored.initial }),
      updatedAt: deps.now(),
    })
  }

  const onlyProfileSyncChanged = (
    before: ChannelSettingsView,
    channel: SettingsChannel,
    change: BotChannelChange,
    secretsChanged: boolean,
  ) =>
    !secretsChanged &&
    before.profileSync !== change.profileSync &&
    before.enabled === change.enabled &&
    JSON.stringify(before.values) === JSON.stringify(channelValuesOf(channel.fields, change.values))

  return {
    view,
    readiness(botId, channel) {
      const current = view(botId, channel)
      if (!current.enabled) return { state: "off" }
      const missing = missingChannelFields(
        channel.fields,
        current.values,
        (key) => current.secrets[key] === true,
      )
      return missing.length > 0 ? { state: "incomplete", missing } : { state: "ready" }
    },
    revision: (botId, channelId) => revisions.get(channelRecordKey(botId, channelId)) ?? 0,
    configure(botId, channel, change) {
      return serial(async () => {
        const before = await deps.vault.read(botId, channel.id)
        const secrets = secretsAfter(before, channel, change)
        const secretsChanged =
          Object.keys(before).length !== Object.keys(secrets).length ||
          Object.entries(secrets).some(([key, value]) => before[key] !== value)
        const reconnect = !onlyProfileSyncChanged(
          view(botId, channel),
          channel,
          change,
          secretsChanged,
        )
        if (secretsChanged) await deps.vault.write(botId, channel.id, secrets)
        await store(botId, channel, {
          enabled: change.enabled,
          values: change.values,
          secrets: Object.keys(secrets),
          profileSync: change.profileSync,
        })
        changed(botId, channel.id, reconnect)
      })
    },
    async resolve(botId, channel) {
      const current = view(botId, channel)
      const secrets = await deps.vault.read(botId, channel.id)
      for (const field of channel.fields) {
        if (
          field.kind === "secret" &&
          current.secrets[field.key] === true &&
          secrets[field.key] === undefined
        ) {
          throw new Error(
            `the stored ${field.key} is missing from DSH's credential store; set it again`,
          )
        }
      }
      return withSecrets(channel, current.values, secrets)
    },
    async preview(botId, channel, change) {
      const stored = await deps.vault.read(botId, channel.id)
      return withSecrets(channel, change.values, secretsAfter(stored, channel, change))
    },
    markInitialFailed(botId, channel, failure) {
      return serial(async () => {
        const current = view(botId, channel)
        await store(botId, channel, {
          enabled: false,
          values: current.values,
          secrets: Object.entries(current.secrets)
            .filter(([, set]) => set)
            .map(([key]) => key),
          profileSync: current.profileSync,
          initial: failure,
        })
        changed(botId, channel.id, false)
      })
    },
    upgrade(channel) {
      return serial(async () => {
        const current = settingsVersionOf(channel)
        for (const [, record] of [...deps.records.entries()]) {
          if (record.channelId !== channel.id || (record.settingsVersion ?? 1) >= current) continue
          const upgraded = upgradedOf(record, channel)
          if (upgraded.state !== "current") continue
          for (const note of upgraded.notes) {
            deps.warn(
              `bot-core: settings of channel "${channel.id}" of bot ${record.botId} upgraded to version ${current}: ${note}`,
            )
          }
          await store(record.botId, channel, { ...record, values: upgraded.values })
          changed(record.botId, channel.id, true)
        }
      })
    },
    purge(keep) {
      return serial(async () => {
        for (const [key, record] of [...deps.records.entries()]) {
          if (keep(record.botId)) continue
          await deps.vault.write(record.botId, record.channelId, {})
          await deps.records.delete(key)
          changed(record.botId, record.channelId, true)
        }
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
