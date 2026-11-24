import type {
  ConnectorActionView,
  ConnectorDecisionRecord,
  ConnectorJson,
} from "@1outres/dsh-bot-core"
import type { DiscordComponentRow, DiscordEmbed, DiscordMessageEdit } from "../discord"
import { clip } from "../interactions/render"
import { MESSAGE_LIMIT } from "../split"
import type { DiscordLocale } from "../texts"
import { encodeActionCustomId } from "./custom-id"
import { actionText } from "./texts"

const TITLE_LIMIT = 256
const DESCRIPTION_LIMIT = 4096
/** Longest preview field value shown on a card. */
export const FIELD_VALUE_LIMIT = 300
/** Longest excerpt of a result shown on a card. */
export const RESULT_LIMIT = 500

const MARKDOWN = /[\\`*_~|>#[\]()<@:-]/g

/** Untrusted text shown as itself: no formatting, links, mentions or headings. */
export function literal(value: string): string {
  return value.replace(MARKDOWN, (character) => `\\${character}`)
}

const FENCE = "```"

/** Untrusted text in a code block, which shows it as typed; a fence inside cannot close it. */
export function codeBlock(value: string): string {
  return `${FENCE}text\n${value.replaceAll(FENCE, "`\u200b``")}\n${FENCE}`
}

const timestamp = (at: number, style: "f" | "R") => `<t:${Math.floor(at / 1000)}:${style}>`

function who(decision: ConnectorDecisionRecord, self: string, locale: DiscordLocale): string {
  const { origin } = decision
  if (origin.kind === "web") return actionText("byWeb", locale)
  return origin.channelId === self
    ? actionText("byHere", locale, { person: origin.person })
    : actionText("byChannel", locale, {
        person: literal(origin.person),
        channel: literal(origin.channelName),
      })
}

const resultOf = (text: string | undefined, data: ConnectorJson): string | undefined =>
  text ?? (data === null ? undefined : JSON.stringify(data))

/** The card's first line: where the action stands, who decided and how it ended. */
export function statusLine(view: ConnectorActionView, self: string, locale: DiscordLocale): string {
  const { status } = view
  switch (status.state) {
    case "pending":
      return actionText("pending", locale, { expires: timestamp(view.expiresAt, "R") })
    case "approved":
      return actionText("approved", locale, { who: who(status.decision, self, locale) })
    case "executing":
      return actionText("executing", locale, { who: who(status.decision, self, locale) })
    case "succeeded": {
      const head = actionText("succeeded", locale, { who: who(status.decision, self, locale) })
      const result = resultOf(status.text, status.result)
      return result === undefined
        ? head
        : `${head}\n**${actionText("result", locale)}**\n${codeBlock(clip(result, RESULT_LIMIT))}`
    }
    case "failed":
      return actionText("failedApproved", locale, {
        who: who(status.decision, self, locale),
        reason: literal(clip(status.reason, RESULT_LIMIT)),
      })
    case "interrupted":
      return actionText("interrupted", locale, { who: who(status.decision, self, locale) })
    case "rejected":
      return actionText("rejected", locale, { who: who(status.decision, self, locale) })
    case "expired":
      return actionText("expired", locale)
    case "cancelled":
      return actionText("cancelled", locale)
  }
}

/** The preview as an embed: the title, the connector and tool, the fields, the body (cut to fit) and the times. */
export function actionEmbed(view: ConnectorActionView, locale: DiscordLocale): DiscordEmbed {
  const { preview } = view
  const head = `-# ${literal(view.connector.name ?? view.connector.id)} · \`${view.toolName}\``
  const fields = preview.fields.map(
    (field) =>
      `**${literal(clip(field.label, FIELD_VALUE_LIMIT))}**: ${literal(clip(field.value, FIELD_VALUE_LIMIT))}`,
  )
  const times = `-# ${actionText("requested", locale, {
    at: timestamp(view.createdAt, "f"),
    expires: timestamp(view.expiresAt, "f"),
  })}`
  const parts = [head, ...fields]
  const fixed = [...parts, times].join("\n\n").length + 4
  const body = preview.body
  if (body !== undefined && body !== "") {
    const note = `*${actionText("truncated", locale)}*`
    const whole = codeBlock(body)
    if (fixed + whole.length <= DESCRIPTION_LIMIT) parts.push(whole)
    else {
      const room = DESCRIPTION_LIMIT - fixed - note.length - codeBlock("").length - 8
      parts.push(codeBlock(clip(body, Math.max(0, room))), note)
    }
  }
  parts.push(times)
  return {
    title: clip(`🔐 ${preview.title}`, TITLE_LIMIT),
    description: clip(parts.join("\n\n"), DESCRIPTION_LIMIT),
  }
}

function decisionRow(view: ConnectorActionView, locale: DiscordLocale): DiscordComponentRow {
  return [
    {
      kind: "button",
      customId: encodeActionCustomId(view.id, "approve"),
      label: actionText("approve", locale),
      style: "success",
      disabled: false,
    },
    {
      kind: "button",
      customId: encodeActionCustomId(view.id, "reject"),
      label: actionText("reject", locale),
      style: "danger",
      disabled: false,
    },
  ]
}

/** A connector action's card: its state, its preview, and the decision buttons while it is pending. */
export function renderActionCard(
  view: ConnectorActionView,
  self: string,
  locale: DiscordLocale,
): DiscordMessageEdit {
  return {
    content: clip(statusLine(view, self, locale), MESSAGE_LIMIT),
    embeds: [actionEmbed(view, locale)],
    components: view.status.state === "pending" ? [decisionRow(view, locale)] : [],
  }
}

/** What a card of an action the ledger no longer keeps becomes. */
export function goneCard(locale: DiscordLocale): DiscordMessageEdit {
  return { content: actionText("gone", locale), components: [] }
}

/** What a card becomes in the DM of someone who is no longer an approver: no preview stays. */
export function withdrawnCard(locale: DiscordLocale): DiscordMessageEdit {
  return { content: actionText("withdrawn", locale), embeds: [], components: [] }
}
