import type { BotChannelLink } from "@1outres/dsh-bot-core"
import type { DmRecipient } from "../directory"
import type { DiscordActions } from "../discord"
import type { DiscordLocale } from "../texts"
import { type DigestEntry, renderDigest } from "./digest"
import type { ApprovalDigest, ApprovalRecords } from "./records"

export type DigestRead =
  | { readonly ok: true; readonly entries: readonly DigestEntry[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

export interface DigestKeeperDeps {
  link: Pick<BotChannelLink, "pendingActions"> & { readonly bot: { readonly name: string } }
  actions: Pick<DiscordActions, "send" | "edit" | "remove" | "pin">
  records: ApprovalRecords
  locale: DiscordLocale
  closed(): boolean
  warn(message: string): void
}

/**
 * The pending approvals list of each approver's DM: one message, pinned
 * once, edited whenever what it lists changes. One that is gone (deleted in
 * Discord) is posted again and pinned again; a pin Discord refuses is not
 * tried again for that message, which is still kept up to date. Its
 * callers run it in order with the cards.
 */
export interface DigestKeeper {
  /** Bring every approver's list up to date. */
  refresh(recipients: readonly DmRecipient[]): Promise<void>
  /** What an approver's list shows, linking to that approver's cards; refused for anyone else. */
  entriesOf(userId: string): DigestRead
  /** Remove the list of someone who is no longer an approver. */
  withdraw(digest: ApprovalDigest): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createDigestKeeper(deps: DigestKeeperDeps): DigestKeeper {
  const { records } = deps
  /** What each list shows now, as last written in this connection. */
  const shown = new Map<string, string>()
  const warn = (what: string, error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-discord: ${what}: ${messageOf(error)}`)
  }

  const entriesOf = (userId: string): DigestRead => {
    const result = deps.link.pendingActions(userId)
    if (!result.ok) return result
    const entries = result.actions.map((action): DigestEntry => {
      const card = records.card(action.id, userId)
      return {
        action,
        card:
          card === undefined ? undefined : { channelId: card.channelId, messageId: card.messageId },
      }
    })
    return { ok: true, entries }
  }

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
        shown.delete(digest.userId)
        await records.forgetDigest(digest.userId)
        return
      case "full":
      case "forbidden":
        if (!deps.closed()) {
          deps.warn(
            `bot-discord: Discord refused to pin the pending approvals list in user ${digest.userId}'s DM (${outcome === "full" ? "the DM holds the most pins Discord allows" : "not allowed"}); it is kept up to date unpinned`,
          )
        }
        await records.saveDigest({ ...digest, pin: "abandoned" })
    }
  }

  const post = async (
    recipient: DmRecipient,
    content: string,
    message: ReturnType<typeof renderDigest>,
  ) => {
    const messageId = await deps.actions.send(recipient.channelId, {
      content: message.content,
      embeds: message.embeds ?? [],
      components: message.components,
    })
    const digest: ApprovalDigest = {
      userId: recipient.userId,
      channelId: recipient.channelId,
      messageId,
      pin: "due",
    }
    await records.saveDigest(digest)
    shown.set(recipient.userId, content)
    await pin(digest)
  }

  const refreshOne = async (recipient: DmRecipient) => {
    const read = entriesOf(recipient.userId)
    if (!read.ok) return
    const message = renderDigest(deps.link.bot.name, read.entries, deps.locale)
    const content = JSON.stringify(message)
    const digest = records.digest(recipient.userId)
    if (digest !== undefined && digest.channelId !== recipient.channelId) {
      await records.forgetDigest(recipient.userId)
    } else if (digest !== undefined) {
      if (shown.get(recipient.userId) !== content) {
        if ((await deps.actions.edit(digest.channelId, digest.messageId, message)) === "missing") {
          shown.delete(recipient.userId)
          await records.forgetDigest(recipient.userId)
          await post(recipient, content, message)
          return
        }
        shown.set(recipient.userId, content)
      }
      if (digest.pin === "due") await pin(digest)
      return
    }
    await post(recipient, content, message)
  }

  return {
    async refresh(recipients) {
      for (const recipient of recipients) {
        if (deps.closed()) return
        try {
          await refreshOne(recipient)
        } catch (error) {
          warn("could not update the pending approvals list", error)
        }
      }
    },
    entriesOf,
    async withdraw(digest) {
      try {
        await deps.actions.remove(digest.channelId, digest.messageId)
        shown.delete(digest.userId)
        await records.forgetDigest(digest.userId)
      } catch (error) {
        warn("could not remove the pending approvals list of a former approver", error)
      }
    },
  }
}
