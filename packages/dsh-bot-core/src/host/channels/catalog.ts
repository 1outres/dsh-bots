import type { BotChannel } from "../../contract"
import { checkChannelDescriptor, sourceOf } from "../../shared/channels"
import { checkChannelCapabilities } from "./capabilities"

export const settingsVersionOf = (channel: Pick<BotChannel, "settingsVersion">): number =>
  channel.settingsVersion ?? 1

export function checkChannelHooks(channel: BotChannel): void {
  const what = `channel "${channel.id}"`
  const version = settingsVersionOf(channel)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`${what}: settingsVersion must be a positive integer`)
  }
  if (version > 1 && channel.upgradeSettings === undefined) {
    throw new Error(`${what}: settingsVersion ${version} needs upgradeSettings`)
  }
  const sourced = channel.fields.find((field) => sourceOf(field) !== undefined)
  if (sourced !== undefined && channel.options === undefined) {
    throw new Error(`${what}: field "${sourced.key}" names a source, so the channel needs options`)
  }
}

export interface ChannelCatalog {
  register(channel: BotChannel): () => void
  list(): readonly BotChannel[]
  get(id: string): BotChannel | undefined
  subscribe(listener: () => void): () => void
}

export function createChannelCatalog(): ChannelCatalog {
  const channels = new Map<string, BotChannel>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    register(channel) {
      checkChannelDescriptor(channel)
      checkChannelCapabilities(channel, channel.capabilities)
      checkChannelHooks(channel)
      if (channels.has(channel.id))
        throw new Error(`bot channel "${channel.id}" is already registered`)
      channels.set(channel.id, channel)
      publish()
      return () => {
        if (channels.get(channel.id) !== channel) return
        channels.delete(channel.id)
        publish()
      }
    },
    list: () => [...channels.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    get: (id) => channels.get(id),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
