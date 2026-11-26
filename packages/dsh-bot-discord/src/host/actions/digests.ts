import type { BotChannelLink } from "@1outres/dsh-bot-core"
import type { DiscordActions } from "../discord"
import type { HomeChannel } from "../home-target"
import type { DiscordLocale } from "../texts"
import { type DigestEntry, renderDigest } from "./digest"
import type { ApprovalDigest, ApprovalRecords } from "./records"

export type DigestRead =
  | { readonly ok: true; readonly entries: readonly DigestEntry[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

export interface DigestKeeperDeps {
  link: Pick<BotChannelLink, "pendingActions" | "openActions"> & {
    readonly bot: { readonly name: string }
  }
  actions: Pick<DiscordActions, "send" | "edit" | "pin">
  records: ApprovalRecords
  locale: DiscordLocale
  closed(): boolean
  warn(message: string): void
}

/**
 * The pending approvals list at the home: one message, pinned once, edited
 * whenever what it lists changes. One that is gone (deleted in Discord) is
 * posted again and pinned again; a pin Discord refuses is not tried again for
 * that message, which is still kept up to date. Its callers run it in order
 * with the cards.
 */
export interface DigestKeeper {
  /** Bring the home's list up to date. */
  refresh(home: HomeChannel): Promise<void>
  /** What the list shows, for `/pending`: refused for anyone but an owner. */
  entriesFor(userId: string, home: HomeChannel): DigestRead
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createDigestKeeper(deps: DigestKeeperDeps): DigestKeeper {
  const { records } = deps
  /** What the list shows now, as last written in this connection. */
  let shown: string | undefined
  const warn = (what: string, error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-discord: ${what}: ${messageOf(error)}`)
  }

  const entriesOf = (
    actions: ReturnType<DigestKeeperDeps["link"]["openActions"]>,
    home: HomeChannel,
  ) =>
    actions.map((action): DigestEntry => {
      const card = records.card(action.id)
      return {
        action,
        card:
          card === undefined
            ? undefined
            : { guildId: home.guildId, channelId: card.channelId, messageId: card.messageId },
      }
    })

  const pin = async (digest: ApprovalDigest) => {
    let outcome: Awaited<ReturnType<DigestKeeperDeps["actions"]["pin"]>>
    try {
      outcome = await deps.actions.pin(digest.channelId, digest.messageId)
    } catch (error) {
      warn("could not pin the pending approvals list; it is kept up to date unpinned", error)
      await records.saveDigest({ ...digest, pin: "abandoned" })
      return
    }
    switch (outcome) {
      case "pinned":
        await records.saveDigest({ ...digest, pin: "pinned" })
        return
      case "missing":
        shown = undefined
        await records.forgetDigest()
        return
      case "full":
      case "forbidden":
        if (!deps.closed()) {
          deps.warn(
            `bot-discord: Discord refused to pin the pending approvals list (${outcome === "full" ? "the channel holds the most pins Discord allows" : "not allowed"}); it is kept up to date unpinned`,
          )
        }
        await records.saveDigest({ ...digest, pin: "abandoned" })
    }
  }

  const post = async (
    home: HomeChannel,
    content: string,
    message: ReturnType<typeof renderDigest>,
  ) => {
    const messageId = await deps.actions.send(home.channelId, {
      content: message.content,
      embeds: message.embeds ?? [],
      components: message.components,
    })
    const digest: ApprovalDigest = { channelId: home.channelId, messageId, pin: "due" }
    await records.saveDigest(digest)
    shown = content
    await pin(digest)
  }

  const refreshAt = async (home: HomeChannel) => {
    const message = renderDigest(
      deps.link.bot.name,
      entriesOf(deps.link.openActions(), home),
      deps.locale,
    )
    const content = JSON.stringify(message)
    const digest = records.digest()
    if (digest === undefined) return post(home, content, message)
    if (shown !== content) {
      if ((await deps.actions.edit(digest.channelId, digest.messageId, message)) === "missing") {
        shown = undefined
        await records.forgetDigest()
        return post(home, content, message)
      }
      shown = content
    }
    if (digest.pin === "due") await pin(digest)
  }

  return {
    async refresh(home) {
      if (deps.closed()) return
      try {
        await refreshAt(home)
      } catch (error) {
        warn("could not update the pending approvals list", error)
      }
    },
    entriesFor(userId, home) {
      const result = deps.link.pendingActions(userId)
      return result.ok ? { ok: true, entries: entriesOf(result.actions, home) } : result
    },
  }
}
