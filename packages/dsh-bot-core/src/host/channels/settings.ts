import {
  type BotChannelChange,
  type BotChannelDescriptor,
  type BotChannelPublicValues,
  channelValuesOf,
  missingChannelFields,
} from "../../shared/channels"
import type { BotTable } from "../registry"
import { type ChannelRecord, channelRecordKey } from "./domain"
import type { SecretVault } from "./vault"

export interface ChannelSettingsDeps {
  /** The channels table of CHANNELS_DOMAIN (not the bots table). */
  records: BotTable<ChannelRecord>
  vault: SecretVault
  now(): number
}

/** A bot's stored settings for a channel, without secret values. */
export interface ChannelSettingsView {
  readonly enabled: boolean
  readonly values: BotChannelPublicValues
  readonly secrets: Readonly<Record<string, boolean>>
}

/** Whether a bot's settings let it connect to a channel. */
export type ChannelReadiness =
  | { readonly state: "off" }
  | { readonly state: "incomplete"; readonly missing: readonly string[] }
  | { readonly state: "ready" }

export interface ChannelSettings {
  view(botId: string, channel: BotChannelDescriptor): ChannelSettingsView
  readiness(botId: string, channel: BotChannelDescriptor): ChannelReadiness
  /** Changes with every stored change of the bot's settings for the channel (in this process). */
  revision(botId: string, channelId: string): number
  /** Store a parsed change; secrets go to the vault first. Saves of one store never interleave. */
  configure(botId: string, channel: BotChannelDescriptor, change: BotChannelChange): Promise<void>
  /**
   * Every field's value, secrets included, for a connection.
   * @throws when a secret the settings name is gone from the vault.
   */
  resolve(botId: string, channel: BotChannelDescriptor): Promise<BotChannelPublicValues>
  /** Forget the settings (and secrets) of bots `keep` refuses. */
  purge(keep: (botId: string) => boolean): Promise<void>
  /** Called with the bot and channel after every stored change. */
  subscribe(listener: (botId: string, channelId: string) => void): () => void
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
  const changed = (botId: string, channelId: string) => {
    const key = channelRecordKey(botId, channelId)
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
    for (const listener of [...listeners]) listener(botId, channelId)
  }

  const view = (botId: string, channel: BotChannelDescriptor): ChannelSettingsView => {
    const record = deps.records.get(channelRecordKey(botId, channel.id))
    const stored = new Set(record?.secrets ?? [])
    return {
      enabled: record?.enabled ?? false,
      values: channelValuesOf(channel.fields, record?.values ?? {}),
      secrets: Object.fromEntries(
        channel.fields
          .filter((field) => field.kind === "secret")
          .map((field) => [field.key, stored.has(field.key)]),
      ),
    }
  }

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
        const secrets: Record<string, string> = { ...(await deps.vault.read(botId, channel.id)) }
        let secretsChanged = false
        for (const field of channel.fields) {
          if (field.kind !== "secret") continue
          const edit = change.secrets[field.key] ?? { op: "keep" }
          if (edit.op === "set" && secrets[field.key] !== edit.value) {
            secrets[field.key] = edit.value
            secretsChanged = true
          }
          if (edit.op === "clear" && secrets[field.key] !== undefined) {
            delete secrets[field.key]
            secretsChanged = true
          }
        }
        if (secretsChanged) await deps.vault.write(botId, channel.id, secrets)
        await deps.records.put(channelRecordKey(botId, channel.id), {
          botId,
          channelId: channel.id,
          enabled: change.enabled,
          values: channelValuesOf(channel.fields, change.values) as ChannelRecord["values"],
          secrets: Object.keys(secrets).sort(),
          updatedAt: deps.now(),
        })
        changed(botId, channel.id)
      })
    },
    async resolve(botId, channel) {
      const current = view(botId, channel)
      const secrets = await deps.vault.read(botId, channel.id)
      const values: Record<string, string | readonly string[]> = { ...current.values }
      for (const field of channel.fields) {
        if (field.kind !== "secret") continue
        const value = secrets[field.key]
        if (current.secrets[field.key] === true && value === undefined) {
          throw new Error(
            `the stored ${field.key} is missing from DSH's credential store; set it again`,
          )
        }
        values[field.key] = value ?? ""
      }
      return values
    },
    purge(keep) {
      return serial(async () => {
        for (const [key, record] of [...deps.records.entries()]) {
          if (keep(record.botId)) continue
          await deps.vault.write(record.botId, record.channelId, {})
          await deps.records.delete(key)
          changed(record.botId, record.channelId)
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
