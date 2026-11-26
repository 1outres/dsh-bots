import type { BotChannelLink, BotChannelProfile, BotChannelText } from "@1outres/dsh-bot-core"
import type { DiscordAccount, DiscordActions } from "../discord"
import { createSerialQueue } from "../queue"
import type { AppliedProfile, ProfileRecords } from "./records"
import { refusalProblem, unreachableProblem, usernameProblem } from "./texts"
import { discordUsernameOf } from "./username"

export interface ProfilePresenterDeps {
  link: Pick<BotChannelLink, "bot" | "reportProfile">
  actions: Pick<DiscordActions, "setUsername" | "setAvatar">
  records: ProfileRecords
  closed(): boolean
  warn(message: string): void
}

export interface ProfilePresenter {
  received(profile: BotChannelProfile): void
  ready(account: DiscordAccount): void
}

interface Applied {
  readonly applied: AppliedProfile
  readonly username: string
  readonly problems: readonly BotChannelText[]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const sameApplied = (left: AppliedProfile, right: AppliedProfile) =>
  left.username === right.username && left.avatar === right.avatar

export function createProfilePresenter(deps: ProfilePresenterDeps): ProfilePresenter {
  const queue = createSerialQueue()
  let wanted: BotChannelProfile | undefined
  let account: DiscordAccount | undefined

  const applyAvatar = async (
    profile: BotChannelProfile,
    applied: AppliedProfile,
  ): Promise<{ readonly applied: AppliedProfile; readonly problem?: BotChannelText }> => {
    const { avatar } = profile
    if (avatar === undefined || applied.avatar === avatar.digest) return { applied }
    const outcome = await deps.actions.setAvatar({ mediaType: avatar.mediaType, data: avatar.data })
    return outcome.ok
      ? { applied: { ...applied, avatar: avatar.digest } }
      : { applied, problem: refusalProblem("avatar", outcome.refusal) }
  }

  const applyUsername = async (
    profile: BotChannelProfile,
    applied: AppliedProfile,
    current: string,
  ): Promise<{
    readonly applied: AppliedProfile
    readonly username: string
    readonly problem?: BotChannelText
  }> => {
    if (profile.name === undefined) return { applied, username: current }
    const check = discordUsernameOf(profile.name)
    if (!check.ok)
      return { applied, username: current, problem: usernameProblem(profile.name, check) }
    const { username } = check
    if (current === username || applied.username === username) {
      return { applied: { ...applied, username }, username: current }
    }
    const outcome = await deps.actions.setUsername(username)
    return outcome.ok
      ? { applied: { ...applied, username }, username }
      : { applied, username: current, problem: refusalProblem("username", outcome.refusal) }
  }

  const applyTo = async (profile: BotChannelProfile, self: DiscordAccount): Promise<Applied> => {
    const before = deps.records.applied(self.id)
    const save = async (from: AppliedProfile, to: AppliedProfile) => {
      if (!sameApplied(from, to)) await deps.records.save(self.id, to)
    }
    const avatar = await applyAvatar(profile, before)
    await save(before, avatar.applied)
    const name = await applyUsername(profile, avatar.applied, self.username)
    await save(avatar.applied, name.applied)
    const problems = [avatar.problem, name.problem].filter(
      (problem): problem is BotChannelText => problem !== undefined,
    )
    return { applied: name.applied, username: name.username, problems }
  }

  const apply = async () => {
    const profile = wanted
    const self = account
    if (deps.closed() || profile === undefined || self === undefined) return
    let problems: readonly BotChannelText[]
    try {
      const result = await applyTo(profile, self)
      if (account === self) account = { ...self, username: result.username }
      problems = result.problems
    } catch (error) {
      problems = [unreachableProblem(messageOf(error))]
    }
    if (deps.closed() || wanted !== profile) return
    for (const problem of problems) {
      deps.warn(
        `bot-discord: the profile of bot "${deps.link.bot.name}" was not fully applied: ${problem.en}`,
      )
    }
    deps.link.reportProfile(
      problems.length === 0
        ? { digest: profile.digest, state: "synced" }
        : { digest: profile.digest, state: "failed", problems },
    )
  }

  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    const run = () => {
      scheduled = false
      return apply()
    }
    queue.push(run).catch((error: unknown) => {
      if (!deps.closed()) deps.warn(`bot-discord: could not apply the profile: ${messageOf(error)}`)
    })
  }

  return {
    received(profile) {
      wanted = profile
      schedule()
    },
    ready(next) {
      account = next
      schedule()
    },
  }
}
