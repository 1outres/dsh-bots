import type { BotChannelLink, BotChannelProfile, BotChannelText } from "@1outres/dsh-bot-core"
import type { MatrixApi } from "./matrix"
import { createSerialQueue } from "./queue"
import type { AccountRecords } from "./records/accounts"

export function createProfilePresenter(deps: {
  readonly link: Pick<BotChannelLink, "bot" | "reportProfile">
  readonly api: Pick<MatrixApi, "setDisplayName" | "setAvatarUrl" | "upload">
  readonly accounts: AccountRecords
  readonly signal: AbortSignal
  closed(): boolean
  warn(message: string): void
}) {
  const queue = createSerialQueue()
  let wanted: BotChannelProfile | undefined
  let ready = false

  const apply = async () => {
    const profile = wanted
    if (profile === undefined || !ready || deps.closed()) return
    const botId = deps.link.bot.id
    const applied = deps.accounts.get(botId)?.profile ?? {}
    const problems: BotChannelText[] = []
    let next = { ...applied }
    try {
      if (profile.name !== undefined && applied.name !== profile.name) {
        await deps.api.setDisplayName(profile.name, deps.signal)
        next = { ...next, name: profile.name }
      }
      if (profile.avatar !== undefined && applied.avatar !== profile.avatar.digest) {
        const url = await deps.api.upload(
          profile.avatar.data,
          profile.avatar.mediaType,
          "avatar.png",
          deps.signal,
        )
        await deps.api.setAvatarUrl(url, deps.signal)
        next = { ...next, avatar: profile.avatar.digest }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      problems.push({
        en: `The name and avatar could not be sent to Matrix: ${message}`,
        ja: `名前とアバターを Matrix に送れませんでした: ${message}`,
      })
    }
    if (next.name !== applied.name || next.avatar !== applied.avatar)
      await deps.accounts.profileApplied(botId, next)
    if (deps.closed() || wanted !== profile) return
    deps.link.reportProfile(
      problems.length === 0
        ? { digest: profile.digest, state: "synced" }
        : { digest: profile.digest, state: "failed", problems },
    )
  }

  const schedule = () => {
    queue.push(apply).catch((error: unknown) => {
      if (!deps.closed()) deps.warn(`bot-matrix: could not apply the profile: ${String(error)}`)
    })
  }

  return {
    received(profile: BotChannelProfile) {
      wanted = profile
      schedule()
    },
    ready() {
      ready = true
      schedule()
    },
  }
}
