import type { BotChannelLink, SenderInquiryView } from "@1outres/dsh-bot-core"
import type { DiscordActions, DiscordComponentPress } from "../discord"
import type { DiscordPlace } from "../home"
import type { HomeTarget } from "../home-target"
import type { SerialQueue } from "../queue"
import { type DiscordLocale, localeOf, notHomeText } from "../texts"
import { decodeInquiryCustomId } from "./custom-id"
import type { InquiryCards } from "./records"
import { goneInquiryCard, renderInquiryCard } from "./render"
import { inquiryText } from "./texts"

export interface InquiryPresenterDeps {
  link: Pick<BotChannelLink, "answerSender" | "senderInquiry">
  actions: Pick<DiscordActions, "send" | "edit">
  cards: InquiryCards
  home: HomeTarget
  atHome(place: DiscordPlace): boolean
  locale: DiscordLocale
  self: string
  outbound: SerialQueue
  closed(): boolean
  warn(message: string): void
}

export interface InquiryPresenter {
  start(): Promise<void>
  received(inquiry: SenderInquiryView): Promise<void>
  press(press: DiscordComponentPress): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createInquiryPresenter(deps: InquiryPresenterDeps): InquiryPresenter {
  const { cards, link, locale } = deps
  const render = (inquiry: SenderInquiryView) => renderInquiryCard(inquiry, deps.self, locale)
  const warnUnlessClosed = (what: string) => (error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-discord: ${what}: ${messageOf(error)}`)
  }

  const show = async (inquiry: SenderInquiryView) => {
    const pending = inquiry.status.state === "pending"
    const card = cards.card(inquiry.id)
    if (card !== undefined) {
      const outcome = await deps.actions.edit(card.channelId, card.messageId, render(inquiry))
      if (outcome === "missing" || !pending) await cards.forget(inquiry.id)
      if (outcome === "edited") return
    }
    if (!pending || link.senderInquiry(inquiry.id)?.status.state !== "pending") return
    const home = await deps.home.channel()
    const message = render(inquiry)
    const messageId = await deps.actions.send(home.channelId, {
      content: message.content,
      embeds: message.embeds ?? [],
      components: message.components,
    })
    await cards.save({ inquiryId: inquiry.id, channelId: home.channelId, messageId })
  }

  const settle = async () => {
    for (const card of cards.all()) {
      if (deps.closed()) return
      const inquiry = link.senderInquiry(card.inquiryId)
      if (inquiry?.status.state === "pending") continue
      await deps.actions
        .edit(
          card.channelId,
          card.messageId,
          inquiry === undefined ? goneInquiryCard(locale) : render(inquiry),
        )
        .catch(warnUnlessClosed("could not update a sender question"))
      await cards.forget(card.inquiryId)
    }
  }

  async function onPress(press: DiscordComponentPress) {
    const theirs = localeOf(press.locale)
    if (!deps.atHome(press)) return press.reply({ content: notHomeText(theirs), ephemeral: true })
    const decoded = decodeInquiryCustomId(press.customId)
    if (decoded === undefined) return press.update(goneInquiryCard(locale))
    const result = await link.answerSender(decoded.inquiryId, decoded.choice, press.userId)
    if (result.accepted || result.reason === "settled") {
      await cards.forget(decoded.inquiryId)
      return press.update(render(result.inquiry))
    }
    switch (result.reason) {
      case "not-approver":
        return press.reply({ content: inquiryText("notApprover", theirs), ephemeral: true })
      case "closed":
        return press.reply({ content: inquiryText("closing", theirs), ephemeral: true })
      case "not-offered":
        return press.reply({ content: inquiryText("notOffered", theirs), ephemeral: true })
      case "not-found":
        return press.update(goneInquiryCard(locale))
    }
  }

  return {
    start: () =>
      deps.outbound.push(async () => {
        if (!deps.closed()) await settle()
      }),
    received: (inquiry) =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        await show(inquiry).catch(warnUnlessClosed("could not show a sender question"))
      }),
    async press(press) {
      try {
        await onPress(press)
      } catch (error) {
        warnUnlessClosed("could not answer a sender question button")(error)
      }
    },
  }
}
