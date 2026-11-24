import type {
  BotChannelLink,
  ConnectorActionState,
  ConnectorActionView,
} from "@1outres/dsh-bot-core"
import type { DmRecipient } from "../directory"
import type {
  DiscordActions,
  DiscordCommandResponse,
  DiscordComponentPress,
  DiscordMessageEdit,
} from "../discord"
import type { SerialQueue } from "../queue"
import { type DiscordLocale, directMessagesOnlyText, localeOf } from "../texts"
import { decodeActionCustomId } from "./custom-id"
import { digestEmbed } from "./digest"
import { createDigestKeeper } from "./digests"
import type { ApprovalCard, ApprovalRecords } from "./records"
import { goneCard, renderActionCard, withdrawnCard } from "./render"
import { actionText } from "./texts"

export interface ActionPresenterDeps {
  link: Pick<BotChannelLink, "decide" | "pendingActions" | "connectorAction"> & {
    readonly bot: { readonly name: string }
  }
  actions: Pick<DiscordActions, "send" | "edit" | "remove" | "pin">
  /** Where this bot's cards and lists sit, kept across connections. */
  records: ApprovalRecords
  /** The Discord user ids the settings name as approvers. */
  approvers: readonly string[]
  /** The approvers' DMs (an approver whose DM cannot be opened is left out). */
  recipients(): Promise<readonly DmRecipient[]>
  /** The language of the cards and lists (the notice language). */
  locale: DiscordLocale
  /** This channel's id, to tell its own decisions from other channels'. */
  self: string
  /** Posting and editing, in order with the bridge's other messages. */
  outbound: SerialQueue
  closed(): boolean
  warn(message: string): void
}

/**
 * bot-core's connector actions in the approvers' DMs: one card per approver
 * with the preview and, while the action is pending, Approve and Reject, and
 * one pinned list of the pending ones per approver. Where they sit is kept
 * across connections: a new connection edits them instead of posting them
 * again, brings up to date the cards of actions that ended meanwhile, and
 * withdraws those of people who are no longer approvers. bot-core decides
 * whether the person who pressed may decide.
 */
export interface ActionPresenter {
  /** Bring what earlier connections posted up to date; call once, first. */
  start(): Promise<void>
  received(action: ConnectorActionView): Promise<void>
  press(press: DiscordComponentPress): Promise<void>
  /** The answer to `/pending`: the list, for an approver only, in their language. */
  pending(userId: string, discordLocale: string): DiscordCommandResponse
}

/** States an action may still leave: its cards follow it until it reaches another one. */
const OPEN_STATES: ReadonlySet<ConnectorActionState> = new Set(["pending", "approved", "executing"])

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createActionPresenter(deps: ActionPresenterDeps): ActionPresenter {
  const { locale, records, link } = deps
  const approvers: ReadonlySet<string> = new Set(deps.approvers)
  const digests = createDigestKeeper({
    link,
    actions: deps.actions,
    records,
    locale,
    closed: deps.closed,
    warn: deps.warn,
  })
  const render = (view: ConnectorActionView) => renderActionCard(view, deps.self, locale)
  const warnUnlessClosed = (what: string) => (error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-discord: ${what}: ${messageOf(error)}`)
  }

  /** Edit a card; one that is gone, or whose action ended, is forgotten. */
  const follow = async (card: ApprovalCard, message: DiscordMessageEdit, ended: boolean) => {
    const outcome = await deps.actions.edit(card.channelId, card.messageId, message)
    if (outcome === "missing" || ended) await records.forgetCard(card.actionId, card.userId)
    return outcome
  }

  const post = async (recipient: DmRecipient, view: ConnectorActionView) => {
    const card = render(view)
    const messageId = await deps.actions.send(recipient.channelId, {
      content: card.content,
      embeds: card.embeds ?? [],
      components: card.components,
    })
    await records.saveCard({
      actionId: view.id,
      userId: recipient.userId,
      channelId: recipient.channelId,
      messageId,
    })
  }

  /** The approver's card of the action, unless it sits in a DM this bot can no longer reach. */
  const cardOf = async (actionId: string, recipient: DmRecipient) => {
    const card = records.card(actionId, recipient.userId)
    if (card === undefined || card.channelId === recipient.channelId) return card
    await records.forgetCard(actionId, recipient.userId)
    return undefined
  }

  const stillPending = (actionId: string) =>
    link.connectorAction(actionId)?.status.state === "pending"

  const show = async (view: ConnectorActionView, recipient: DmRecipient) => {
    const ended = !OPEN_STATES.has(view.status.state)
    const card = await cardOf(view.id, recipient)
    if (card !== undefined && (await follow(card, render(view), ended)) === "edited") return
    if (view.status.state === "pending" && stillPending(view.id)) await post(recipient, view)
  }

  const withdraw = async (recipients: readonly DmRecipient[]) => {
    const reachable = new Map(
      recipients.map((recipient) => [recipient.userId, recipient.channelId]),
    )
    const stale = (userId: string, channelId: string) => {
      const current = reachable.get(userId)
      return current !== undefined && current !== channelId
    }
    for (const digest of records.digests()) {
      if (!approvers.has(digest.userId)) await digests.withdraw(digest)
      else if (stale(digest.userId, digest.channelId)) await records.forgetDigest(digest.userId)
    }
    for (const card of records.cards()) {
      if (deps.closed()) return
      if (!approvers.has(card.userId)) {
        await deps.actions
          .edit(card.channelId, card.messageId, withdrawnCard(locale))
          .then(() => records.forgetCard(card.actionId, card.userId))
          .catch(warnUnlessClosed("could not withdraw a connector action card"))
      } else if (stale(card.userId, card.channelId)) {
        await records.forgetCard(card.actionId, card.userId)
      }
    }
  }

  /** Cards of actions that ended, or are no longer kept, while no connection followed them. */
  const settle = async () => {
    const actionIds = new Set(records.cards().map((card) => card.actionId))
    for (const actionId of actionIds) {
      const view = link.connectorAction(actionId)
      if (view !== undefined && OPEN_STATES.has(view.status.state)) continue
      for (const card of records.cards().filter((known) => known.actionId === actionId)) {
        if (deps.closed()) return
        await follow(card, view === undefined ? goneCard(locale) : render(view), true).catch(
          warnUnlessClosed("could not update a connector action"),
        )
      }
    }
  }

  async function onPress(press: DiscordComponentPress) {
    const theirs = localeOf(press.locale)
    if (press.guildId !== null) {
      return press.reply({ content: directMessagesOnlyText(theirs), ephemeral: true })
    }
    const decoded = decodeActionCustomId(press.customId)
    if (decoded === undefined) return press.update(goneCard(locale))
    const result = await link.decide(decoded.actionId, decoded.decision, press.userId)
    if (result.accepted || result.reason === "settled") {
      if (
        OPEN_STATES.has(result.action.status.state) &&
        records.card(decoded.actionId, press.userId) === undefined
      ) {
        await records.saveCard({
          actionId: decoded.actionId,
          userId: press.userId,
          channelId: press.channelId,
          messageId: press.messageId,
        })
      }
      return press.update(render(result.action))
    }
    switch (result.reason) {
      case "not-approver":
        return press.reply({ content: actionText("notApprover", theirs), ephemeral: true })
      case "closed":
        return press.reply({ content: actionText("closing", theirs), ephemeral: true })
      case "not-found":
        return press.update(goneCard(locale))
    }
  }

  return {
    start: () =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        const recipients = await deps.recipients()
        await withdraw(recipients)
        await settle()
        await digests.refresh(recipients)
      }),
    received: (view) =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        const recipients = await deps.recipients()
        for (const recipient of recipients) {
          if (deps.closed()) return
          await show(view, recipient).catch(warnUnlessClosed("could not show a connector action"))
        }
        await digests.refresh(recipients)
      }),
    async press(press) {
      try {
        await onPress(press)
      } catch (error) {
        warnUnlessClosed("could not answer a connector action button")(error)
      }
    },
    pending(userId, discordLocale) {
      const theirs = localeOf(discordLocale)
      const read = digests.entriesOf(userId)
      if (!read.ok) {
        const key = read.reason === "closed" ? "closing" : "pendingNotApprover"
        return { content: actionText(key, theirs), ephemeral: true }
      }
      return {
        content: "",
        embeds: [digestEmbed(link.bot.name, read.entries, theirs)],
        ephemeral: true,
      }
    },
  }
}
