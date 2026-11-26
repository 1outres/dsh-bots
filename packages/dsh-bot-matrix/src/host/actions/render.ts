import type { ConnectorActionView, ConnectorDecisionRecord } from "@1outres/dsh-bot-core"
import { escapeMarkdown } from "../format/markdown"
import { matrixTo } from "../ids"
import { fill, type MatrixLocale, type Texts } from "../texts"

const TEXTS = {
  pending: {
    en: "⏳ Waiting for a decision until {expires}. React ✅ to approve or ❌ to reject.",
    ja: "⏳ {expires} まで判断を待っています。✅ で許可、❌ で拒否します。",
  },
  approved: {
    en: "✅ Approved {who}; it runs once the connector is ready.",
    ja: "✅ {who}許可されました。コネクターの準備ができしだい実行します。",
  },
  executing: { en: "⚙️ Running (approved {who})…", ja: "⚙️ 実行しています（{who}許可）…" },
  succeeded: { en: "✅ Done (approved {who}).", ja: "✅ 実行しました（{who}許可）。" },
  failed: {
    en: "⚠️ Approved {who}, but it failed: {reason}",
    ja: "⚠️ {who}許可されましたが、失敗しました: {reason}",
  },
  interrupted: {
    en: "⚠️ Approved {who}, but DSH stopped while it ran: whether it took effect is unknown. It is not run again.",
    ja: "⚠️ {who}許可されましたが、実行中に DSH が止まりました。反映されたかは分かりません。再実行はしません。",
  },
  rejected: {
    en: "🚫 Rejected {who}; it was not run.",
    ja: "🚫 {who}拒否されました。実行していません。",
  },
  expired: {
    en: "⌛ Expired without a decision; it was not run.",
    ja: "⌛ 判断がないまま期限が切れました。実行していません。",
  },
  cancelled: {
    en: "↩️ The bot cancelled it; it was not run.",
    ja: "↩️ ボットが取り消しました。実行していません。",
  },
  byWeb: { en: "in the Web UI", ja: "Web UI で" },
  byHere: { en: "by {person} in Matrix", ja: "{person} が Matrix で" },
  byChannel: { en: "by {person} in {channel}", ja: "{channel} で {person} が" },
  gone: {
    en: "This action is no longer kept; the bot's page in the Web UI shows its actions.",
    ja: "この操作はもう記録に残っていません。操作の一覧は Web UI のボットの画面で確認できます。",
  },
  digestTitle: {
    en: "📋 Pending approvals of {bot} ({count})",
    ja: "📋 {bot} の承認待ち（{count} 件）",
  },
  digestEmpty: { en: "No pending approvals.", ja: "承認待ちはありません。" },
  notApprover: {
    en: "Only the bot's owners can decide its actions.",
    ja: "このボットの操作を判断できるのはオーナーだけです。",
  },
  pendingNotApprover: {
    en: "Only the bot's owners can see its pending actions.",
    ja: "承認待ちの操作を見られるのは、このボットのオーナーだけです。",
  },
  closing: {
    en: "The bot is reconnecting to Matrix; try again in a moment.",
    ja: "ボットが Matrix に接続し直しています。少し待ってからもう一度試してください。",
  },
} as const satisfies Record<string, Texts>

export const actionText = (
  key: keyof typeof TEXTS,
  locale: MatrixLocale,
  params: Record<string, string | number> = {},
) => fill(TEXTS[key], locale, params)

const when = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`

function who(decision: ConnectorDecisionRecord, self: string, locale: MatrixLocale): string {
  const { origin } = decision
  if (origin.kind === "web") return actionText("byWeb", locale)
  return origin.channelId === self
    ? actionText("byHere", locale, { person: origin.person })
    : actionText("byChannel", locale, { person: origin.person, channel: origin.channelName })
}

export function statusLine(view: ConnectorActionView, self: string, locale: MatrixLocale): string {
  const { status } = view
  switch (status.state) {
    case "pending":
      return actionText("pending", locale, { expires: when(view.expiresAt) })
    case "approved":
    case "executing":
    case "succeeded":
    case "interrupted":
    case "rejected":
      return actionText(status.state, locale, { who: who(status.decision, self, locale) })
    case "failed":
      return actionText("failed", locale, {
        who: who(status.decision, self, locale),
        reason: status.reason,
      })
    case "expired":
    case "cancelled":
      return actionText(status.state, locale)
  }
}

export function renderActionCard(
  view: ConnectorActionView,
  self: string,
  locale: MatrixLocale,
): string {
  const { preview } = view
  const lines = [
    `**🔐 ${escapeMarkdown(preview.title)}**`,
    `${escapeMarkdown(view.connector.name ?? view.connector.id)} · \`${view.toolName}\``,
    ...preview.fields.map(
      (field) => `- **${escapeMarkdown(field.label)}**: ${escapeMarkdown(field.value)}`,
    ),
  ]
  if (preview.body !== undefined && preview.body !== "") {
    lines.push("", "```text", preview.body.replaceAll("```", "`\u200b``"), "```")
  }
  lines.push("", statusLine(view, self, locale))
  return lines.join("\n")
}

export interface DigestEntry {
  readonly action: ConnectorActionView
  readonly card?: { readonly roomId: string; readonly eventId: string }
}

export function renderDigest(
  bot: string,
  entries: readonly DigestEntry[],
  locale: MatrixLocale,
): string {
  const title = `**${actionText("digestTitle", locale, { bot: escapeMarkdown(bot), count: entries.length })}**`
  if (entries.length === 0) return `${title}\n\n${actionText("digestEmpty", locale)}`
  const lines = entries.map((entry, index) => {
    const name = escapeMarkdown(entry.action.preview.title)
    const link =
      entry.card === undefined
        ? `**${name}**`
        : `[${name}](${matrixTo(entry.card.roomId, entry.card.eventId)})`
    return `${index + 1}. ${link} — ${escapeMarkdown(entry.action.connector.name ?? entry.action.connector.id)} · ${when(entry.action.expiresAt)}`
  })
  return `${title}\n\n${lines.join("\n")}`
}
