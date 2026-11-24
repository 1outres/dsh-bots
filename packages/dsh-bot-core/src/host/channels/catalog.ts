import type { BotChannel } from "../../contract"
import { checkChannelDescriptor } from "../../shared/channels"
import { checkChannelCapabilities } from "./capabilities"

/** The channels channel plugins registered, by id. */
export interface ChannelCatalog {
  /** @throws when the descriptor or capabilities are invalid or the id is taken. */
  register(channel: BotChannel): () => void
  list(): readonly BotChannel[]
  get(id: string): BotChannel | undefined
  /** Called after every registration and unregistration. */
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
