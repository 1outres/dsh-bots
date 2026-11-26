import type { BotChannel } from "../../contract"
import {
  type BotChannelChange,
  type BotChannelDescriptor,
  parseChannelChange,
} from "../../shared/channels"
import { descriptorOf } from "../channels/panel"

export interface WelcomeChannelSetup {
  readonly channelId: string
  readonly change: BotChannelChange
}

export type ChannelConfigure = (
  botId: string,
  channelId: string,
  change: BotChannelChange,
) => Promise<unknown>

export interface WelcomeChannelsDeps {
  readonly catalog: {
    list(): readonly BotChannel[]
    get(id: string): BotChannel | undefined
    subscribe(listener: () => void): () => void
  }
}

export interface WelcomeChannels {
  descriptors(): readonly BotChannelDescriptor[]
  parse(input: unknown): readonly WelcomeChannelSetup[]
  apply(botId: string, setups: readonly WelcomeChannelSetup[]): Promise<void>
  attach(configure: ChannelConfigure): () => void
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createWelcomeChannels(deps: WelcomeChannelsDeps): WelcomeChannels {
  let configure: ChannelConfigure | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const offered = (id: string): BotChannel | undefined =>
    configure === undefined ? undefined : deps.catalog.get(id)
  const off = deps.catalog.subscribe(notify)
  return {
    descriptors: () => (configure === undefined ? [] : deps.catalog.list().map(descriptorOf)),
    parse(input) {
      if (!Array.isArray(input)) throw new Error("channels must be a list")
      const seen = new Set<string>()
      return input.map((item: unknown, index) => {
        if (typeof item !== "object" || item === null)
          throw new Error(`channels[${index}] must be an object`)
        const { channelId, change } = item as { channelId?: unknown; change?: unknown }
        if (typeof channelId !== "string")
          throw new Error(`channels[${index}].channelId must be text`)
        const channel = offered(channelId)
        if (channel === undefined) throw new Error(`channel "${channelId}" cannot be set up now`)
        if (seen.has(channelId)) throw new Error(`channel "${channelId}" is set up twice`)
        seen.add(channelId)
        return { channelId, change: parseChannelChange(channel.fields, change) }
      })
    },
    async apply(botId, setups) {
      for (const setup of setups) {
        if (configure === undefined) throw new Error("DSH's credential store is not available")
        await configure(botId, setup.channelId, setup.change)
      }
    },
    attach(next) {
      configure = next
      notify()
      return () => {
        if (configure !== next) return
        configure = undefined
        notify()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      off()
      listeners.clear()
    },
  }
}
