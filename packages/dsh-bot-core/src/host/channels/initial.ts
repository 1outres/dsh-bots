import type { BotChannel } from "../../channel-contract"
import {
  type BotChannelConfigureResult,
  type BotChannelDefault,
  type BotChannelInitialFailure,
  type BotChannelPublicValues,
  type BotChannelText,
  parseChannelChange,
} from "../../shared/channels"
import type { SettingsChannel } from "./settings"

export interface InitialBot {
  readonly id: string
  readonly name: string
  readonly language: string
}

export interface InitialChannelsDeps {
  channel(id: string): BotChannel | undefined
  defaults(): readonly BotChannelDefault[]
  shared(channel: BotChannel): Promise<BotChannelPublicValues>
  configure(botId: string, channelId: string, change: unknown): Promise<BotChannelConfigureResult>
  markFailed(
    botId: string,
    channel: SettingsChannel,
    failure: BotChannelInitialFailure,
  ): Promise<void>
  deadline(): AbortSignal
  now(): number
  warn(message: string): void
}

export interface InitialChannels {
  apply(bot: InitialBot, channelIds: readonly string[]): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const NOT_OFFERED: BotChannelText = {
  en: "The channel no longer sets itself up for new bots (turned off in dsh-bots settings, or its settings are incomplete).",
  ja: "このチャネルは新しいボットで自動でオンにしなくなりました（dsh-bots の設定でオフにされたか、設定がそろっていません）。",
}

export function createInitialChannels(deps: InitialChannelsDeps): InitialChannels {
  const settle = async (
    bot: InitialBot,
    channel: BotChannel,
  ): Promise<BotChannelText | undefined> => {
    const offered = deps.defaults().find((offer) => offer.channelId === channel.id)
    if (offered === undefined) return NOT_OFFERED
    if (offered.initial.state === "unavailable") return offered.initial.reason
    if (channel.initialSettings === undefined) return NOT_OFFERED
    const initial = await channel.initialSettings({
      bot,
      shared: (await deps.shared(channel)) as never,
      signal: deps.deadline(),
    })
    if (initial.state === "unavailable") return initial.reason
    const change = parseChannelChange(channel.fields, {
      enabled: true,
      profileSync: initial.profileSync && channel.capabilities.profile !== undefined,
      values: initial.values,
      secrets: Object.fromEntries(
        Object.entries(initial.secrets).map(([key, value]) => [key, { op: "set", value }]),
      ),
    })
    const result = await deps.configure(bot.id, channel.id, change)
    return result.saved ? undefined : result.reason
  }

  return {
    async apply(bot, channelIds) {
      for (const channelId of channelIds) {
        const channel = deps.channel(channelId)
        let reason: BotChannelText | undefined
        try {
          reason =
            channel === undefined
              ? {
                  en: `channel "${channelId}" is not installed`,
                  ja: `チャネル「${channelId}」はインストールされていません`,
                }
              : await settle(bot, channel)
        } catch (error) {
          reason = { en: messageOf(error) }
        }
        if (reason === undefined) continue
        deps.warn(
          `bot-core: channel "${channelId}" of new bot "${bot.name}" (${bot.id}) was not turned on: ${reason.en}`,
        )
        if (channel === undefined) continue
        await deps
          .markFailed(bot.id, channel, { state: "failed", reason, at: deps.now() })
          .catch((error: unknown) => {
            deps.warn(
              `bot-core: could not record why channel "${channelId}" stayed off: ${messageOf(error)}`,
            )
          })
      }
    },
  }
}

export interface InitialChannelsGate extends InitialChannels {
  attach(channels: InitialChannels): () => void
}

export function createInitialChannelsGate(warn: (message: string) => void): InitialChannelsGate {
  let attached: InitialChannels | undefined
  return {
    async apply(bot, channelIds) {
      if (channelIds.length === 0) return
      if (attached === undefined) {
        warn(
          `bot-core: the channels of new bot "${bot.name}" (${bot.id}) stayed off: DSH's credential store is not available`,
        )
        return
      }
      await attached.apply(bot, channelIds)
    },
    attach(channels) {
      attached = channels
      return () => {
        if (attached === channels) attached = undefined
      }
    },
  }
}
