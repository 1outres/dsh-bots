import type { BotChannelOutput, BotChannelProfileReport } from "../../../channel-contract"
import type {
  BotChannelProfileStatus,
  BotChannelProfileSupport,
  BotChannelText,
} from "../../../shared/channels"
import { channelRecordKey } from "../domain"
import { type ProfileBot, type ProfileRenderer, profileSourceKey } from "./render"

export interface ProfileSyncDeps {
  bot(botId: string): ProfileBot | undefined
  enabled(botId: string, channelId: string): boolean
  renderer: Pick<ProfileRenderer, "profile">
  publish(botId: string, channelId: string, output: BotChannelOutput): void
  warn(message: string): void
}

export interface ProfileSync {
  attached(
    botId: string,
    channelId: string,
    supports: BotChannelProfileSupport,
    signal: AbortSignal,
  ): void
  refresh(botId?: string): void
  reported(botId: string, channelId: string, report: BotChannelProfileReport): void
  status(botId: string, channelId: string): BotChannelProfileStatus | undefined
  subscribe(listener: () => void): () => void
}

interface Outlet {
  readonly botId: string
  readonly channelId: string
  readonly supports: BotChannelProfileSupport
  source: string | undefined
  digest: string | undefined
  status: BotChannelProfileStatus | undefined
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function renderProblem(message: string): BotChannelText {
  return {
    en: `The avatar could not be drawn: ${message}`,
    ja: `アバターを描画できませんでした: ${message}`,
  }
}

export function statusOfReport(report: BotChannelProfileReport): BotChannelProfileStatus {
  return report.state === "synced"
    ? { state: "synced" }
    : { state: "failed", problems: report.problems }
}

export function createProfileSync(deps: ProfileSyncDeps): ProfileSync {
  const outlets = new Map<string, Outlet>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const current = (outlet: Outlet, source: string) =>
    outlets.get(channelRecordKey(outlet.botId, outlet.channelId)) === outlet &&
    outlet.source === source

  const push = async (outlet: Outlet, bot: ProfileBot, source: string) => {
    try {
      const profile = await deps.renderer.profile(bot, outlet.supports)
      if (!current(outlet, source)) return
      outlet.digest = profile.digest
      deps.publish(outlet.botId, outlet.channelId, { kind: "profile", profile })
    } catch (error) {
      if (!current(outlet, source)) return
      deps.warn(
        `bot-core: the profile of bot ${outlet.botId} for channel "${outlet.channelId}" could not be prepared: ${messageOf(error)}`,
      )
      outlet.status = { state: "failed", problems: [renderProblem(messageOf(error))] }
      notify()
    }
  }

  const refreshOutlet = (outlet: Outlet) => {
    if (!deps.enabled(outlet.botId, outlet.channelId)) {
      if (outlet.source === undefined && outlet.status === undefined) return
      outlet.source = undefined
      outlet.digest = undefined
      outlet.status = undefined
      notify()
      return
    }
    const bot = deps.bot(outlet.botId)
    if (bot === undefined) return
    const source = profileSourceKey(bot, outlet.supports)
    if (outlet.source === source) return
    outlet.source = source
    outlet.digest = undefined
    outlet.status = { state: "syncing" }
    notify()
    void push(outlet, bot, source)
  }

  return {
    attached(botId, channelId, supports, signal) {
      if (signal.aborted) return
      const key = channelRecordKey(botId, channelId)
      const outlet: Outlet = {
        botId,
        channelId,
        supports,
        source: undefined,
        digest: undefined,
        status: undefined,
      }
      outlets.set(key, outlet)
      signal.addEventListener(
        "abort",
        () => {
          if (outlets.get(key) !== outlet) return
          outlets.delete(key)
          notify()
        },
        { once: true },
      )
      refreshOutlet(outlet)
    },
    refresh(botId) {
      for (const outlet of [...outlets.values()]) {
        if (botId === undefined || outlet.botId === botId) refreshOutlet(outlet)
      }
    },
    reported(botId, channelId, report) {
      const outlet = outlets.get(channelRecordKey(botId, channelId))
      if (outlet === undefined || outlet.digest !== report.digest) return
      outlet.status = statusOfReport(report)
      notify()
    },
    status: (botId, channelId) => outlets.get(channelRecordKey(botId, channelId))?.status,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
