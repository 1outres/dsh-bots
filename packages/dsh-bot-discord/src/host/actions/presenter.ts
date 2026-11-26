import type {
  BotChannelLink,
  ConnectorActionState,
  ConnectorActionView,
} from "@1outres/dsh-bot-core"
import type {
  DiscordActions,
  DiscordCommandResponse,
  DiscordComponentPress,
  DiscordMessageEdit,
} from "../discord"
import type { DiscordPlace } from "../home"
import type { HomeChannel, HomeTarget } from "../home-target"
import type { SerialQueue } from "../queue"
import { type DiscordLocale, localeOf, notHomeText } from "../texts"
import { decodeActionCustomId } from "./custom-id"
import { digestEmbed } from "./digest"
import { createDigestKeeper } from "./digests"
import type { ApprovalCard, ApprovalRecords } from "./records"
import { goneCard, renderActionCard } from "./render"
import { actionText } from "./texts"

export interface ActionPresenterDeps {
  link: Pick<BotChannelLink, "decide" | "pendingActions" | "openActions" | "connectorAction"> & {
    readonly bot: { readonly name: string }
  }
  actions: Pick<DiscordActions, "send" | "edit" | "pin">
  /** Where this bot's cards and list sit at its home, kept across connections. */
  records: ApprovalRecords
  home: HomeTarget
  /** Whether a press happened at the home. */
  atHome(place: DiscordPlace): boolean
  /** The language of the cards and the list (the notice language). */
  locale: DiscordLocale
  /** This channel's id, to tell its own decisions from other channels'. */
  self: string
  /** Posting and editing, in order with the bridge's other messages. */
  outbound: SerialQueue
  closed(): boolean
  warn(message: string): void
}

/**
 * bot-core's connector actions at the home: one card per action with the
 * preview and, while it is pending, Approve and Reject, and one pinned list
 * of the pending ones. Where they sit is kept across connections: a new
 * connection edits them instead of posting them again and brings up to date
 * the cards of actions that ended meanwhile. bot-core decides whether the
 * person who pressed may decide.
 */
export interface ActionPresenter {
  /** Bring what earlier connections posted at the home up to date; call once, first. */
  start(): Promise<void>
  received(action: ConnectorActionView): Promise<void>
  press(press: DiscordComponentPress): Promise<void>
  /** The answer to `/pending`: the list, for an owner only, in their language. */
  pending(userId: string, discordLocale: string): Promise<DiscordCommandResponse>
}

/** States an action may still leave: its card follows it until it reaches another one. */
const OPEN_STATES: ReadonlySet<ConnectorActionState> = new Set(["pending", "approved", "executing"])

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createActionPresenter(deps: ActionPresenterDeps): ActionPresenter {
  const { locale, records, link } = deps
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
    if (outcome === "missing" || ended) await records.forgetCard(card.actionId)
    return outcome
  }

  const post = async (home: HomeChannel, view: ConnectorActionView) => {
    const card = render(view)
    const messageId = await deps.actions.send(home.channelId, {
      content: card.content,
      embeds: card.embeds ?? [],
      components: card.components,
    })
    await records.saveCard({ actionId: view.id, channelId: home.channelId, messageId })
  }

  const stillPending = (actionId: string) =>
    link.connectorAction(actionId)?.status.state === "pending"

  const show = async (view: ConnectorActionView, home: HomeChannel) => {
    const ended = !OPEN_STATES.has(view.status.state)
    const card = records.card(view.id)
    if (card !== undefined && (await follow(card, render(view), ended)) === "edited") return
    if (view.status.state === "pending" && stillPending(view.id)) await post(home, view)
  }

  /** Cards of actions that ended, or are no longer kept, while no connection followed them. */
  const settle = async () => {
    for (const card of records.cards()) {
      if (deps.closed()) return
      const view = link.connectorAction(card.actionId)
      if (view !== undefined && OPEN_STATES.has(view.status.state)) continue
      await follow(card, view === undefined ? goneCard(locale) : render(view), true).catch(
        warnUnlessClosed("could not update a connector action"),
      )
    }
  }

  async function onPress(press: DiscordComponentPress) {
    const theirs = localeOf(press.locale)
    if (!deps.atHome(press)) {
      return press.reply({ content: notHomeText(theirs), ephemeral: true })
    }
    const decoded = decodeActionCustomId(press.customId)
    if (decoded === undefined) return press.update(goneCard(locale))
    const result = await link.decide(decoded.actionId, decoded.decision, press.userId)
    if (result.accepted || result.reason === "settled") {
      if (
        OPEN_STATES.has(result.action.status.state) &&
        records.card(decoded.actionId) === undefined
      ) {
        await records.saveCard({
          actionId: decoded.actionId,
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
        await settle()
        await digests.refresh(await deps.home.channel())
      }),
    received: (view) =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        const home = await deps.home.channel()
        await show(view, home).catch(warnUnlessClosed("could not show a connector action"))
        await digests.refresh(home)
      }),
    async press(press) {
      try {
        await onPress(press)
      } catch (error) {
        warnUnlessClosed("could not answer a connector action button")(error)
      }
    },
    async pending(userId, discordLocale) {
      const theirs = localeOf(discordLocale)
      const read = digests.entriesFor(userId, await deps.home.channel())
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
