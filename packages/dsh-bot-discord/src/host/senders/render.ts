import type { SenderInquiryView, SenderRuleOrigin } from "@1outres/dsh-bot-core"
import { codeBlock, literal } from "../actions/render"
import type { DiscordComponentRow, DiscordMessageEdit } from "../discord"
import { clip } from "../interactions/render"
import { MESSAGE_LIMIT } from "../split"
import type { DiscordLocale } from "../texts"
import { encodeInquiryCustomId } from "./custom-id"
import { inquiryText } from "./texts"

const TITLE_LIMIT = 256
const DESCRIPTION_LIMIT = 4096
const SAMPLE_LIMIT = 300
const BUTTON_LABEL_LIMIT = 80

const timestamp = (at: number, style: "f" | "R") => `<t:${Math.floor(at / 1000)}:${style}>`

function who(origin: SenderRuleOrigin, self: string, locale: DiscordLocale): string {
  if (origin.kind === "web") return inquiryText("byWeb", locale)
  return origin.channelId === self
    ? inquiryText("byHere", locale, { person: origin.person })
    : inquiryText("byChannel", locale, {
        person: literal(origin.person),
        channel: literal(origin.channelName),
      })
}

export function inquiryStatusLine(
  inquiry: SenderInquiryView,
  self: string,
  locale: DiscordLocale,
): string {
  const { status } = inquiry
  switch (status.state) {
    case "pending":
      return inquiryText("pending", locale, { expires: timestamp(inquiry.expiresAt, "R") })
    case "answered":
      return inquiryText(status.choice.startsWith("allow") ? "answered" : "answeredDeny", locale, {
        choice: inquiryText(status.choice, locale, { domain: literal(inquiry.domain) }),
        who: who(status.origin, self, locale),
      })
    case "covered":
      return inquiryText(status.verdict === "allow" ? "coveredAllow" : "coveredDeny", locale)
    case "expired":
      return inquiryText("expired", locale)
  }
}

function choicesRow(inquiry: SenderInquiryView, locale: DiscordLocale): DiscordComponentRow {
  return inquiry.choices.map((choice) => ({
    kind: "button" as const,
    customId: encodeInquiryCustomId(inquiry.id, choice),
    label: clip(inquiryText(choice, locale, { domain: inquiry.domain }), BUTTON_LABEL_LIMIT),
    style: choice.startsWith("allow") ? ("success" as const) : ("danger" as const),
    disabled: false,
  }))
}

export function renderInquiryCard(
  inquiry: SenderInquiryView,
  self: string,
  locale: DiscordLocale,
): DiscordMessageEdit {
  const pending = inquiry.status.state === "pending"
  const parts = [
    `-# ${literal(inquiry.connector.name ?? inquiry.connector.id)}`,
    `**${inquiryText("account", locale)}**: ${literal(inquiry.account)}`,
    ...(pending ? [inquiryText("waiting", locale, { count: inquiry.waiting })] : []),
    ...(inquiry.samples.length === 0
      ? []
      : [
          `**${inquiryText("latest", locale)}**`,
          codeBlock(inquiry.samples.map((sample) => clip(sample, SAMPLE_LIMIT)).join("\n")),
        ]),
    ...(pending && !inquiry.choices.includes("allow-domain")
      ? [`*${inquiryText("freemail", locale, { domain: literal(inquiry.domain) })}*`]
      : []),
    ...(pending ? [`-# ${inquiryText("expiryNote", locale)}`] : []),
  ]
  return {
    content: clip(inquiryStatusLine(inquiry, self, locale), MESSAGE_LIMIT),
    embeds: [
      {
        title: clip(inquiryText("title", locale, { address: inquiry.address }), TITLE_LIMIT),
        description: clip(parts.join("\n\n"), DESCRIPTION_LIMIT),
      },
    ],
    components: pending ? [choicesRow(inquiry, locale)] : [],
  }
}

export function goneInquiryCard(locale: DiscordLocale): DiscordMessageEdit {
  return { content: inquiryText("gone", locale), components: [] }
}
