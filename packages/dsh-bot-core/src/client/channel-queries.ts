import type {
  BotChannelCheck,
  BotChannelInspection,
  BotChannelOptions,
  BotChannelSettingsRef,
} from "../shared/channels"
import { ChannelsError } from "./channels-model"
import type { RemoteResult } from "./dsh/remote"
import type { BotChannelsRemote, RemoteMount } from "./remote"

/** What the Host's channels answer about settings; rejects with a {@link ChannelsError}. */
export interface ChannelQueries {
  options(
    channelId: string,
    settings: BotChannelSettingsRef,
    source: string,
    signal: AbortSignal,
  ): Promise<BotChannelOptions>
  inspect(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal: AbortSignal,
  ): Promise<BotChannelInspection>
  check(
    channelId: string,
    settings: BotChannelSettingsRef,
    signal: AbortSignal,
  ): Promise<BotChannelCheck>
}

/** One channel's settings as its group asks about them. */
export interface ChannelAsk {
  options(source: string, signal: AbortSignal): Promise<BotChannelOptions>
  inspect(signal: AbortSignal): Promise<BotChannelInspection>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function unwrap<T>(call: () => Promise<RemoteResult<T>>): Promise<T> {
  let result: RemoteResult<T>
  try {
    result = await call()
  } catch (error) {
    throw new ChannelsError({ kind: "connection", message: messageOf(error) })
  }
  if (result.ok) return result.value
  const { message } = result.error
  throw new ChannelsError(
    message === undefined
      ? { kind: "protocol", message: "a refusal without a message" }
      : { kind: "refused", message },
  )
}

export function createChannelQueries(mount: Promise<RemoteMount>): ChannelQueries {
  const channels = async (): Promise<BotChannelsRemote> => {
    const mounted = await mount
    if (mounted.status === "failed") {
      throw new ChannelsError({ kind: "mount", message: mounted.error })
    }
    return mounted.remote.botChannels
  }
  return {
    async options(channelId, settings, source, signal) {
      const remote = await channels()
      return unwrap(() => remote.options(channelId, settings, source, signal))
    },
    async inspect(channelId, settings, signal) {
      const remote = await channels()
      return unwrap(() => remote.inspect(channelId, settings, signal))
    },
    async check(channelId, settings, signal) {
      const remote = await channels()
      return unwrap(() => remote.check(channelId, settings, signal))
    },
  }
}

/** Questions about one channel's settings, as `settings` names them when asked. */
export function askAbout(
  queries: ChannelQueries,
  channelId: string,
  settings: () => BotChannelSettingsRef,
): ChannelAsk {
  return {
    options: (source, signal) => queries.options(channelId, settings(), source, signal),
    inspect: (signal) => queries.inspect(channelId, settings(), signal),
  }
}
