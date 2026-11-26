import type { DiscordLocale } from "../texts"

type Texts = { readonly [Locale in DiscordLocale]: string }

const TEXTS = {
  approve: { en: "Approve", ja: "許可" },
  reject: { en: "Reject", ja: "拒否" },
  pending: {
    en: "⏳ Waiting for your decision; it expires {expires}.",
    ja: "⏳ 判断を待っています。期限は{expires}です。",
  },
  approved: {
    en: "✅ Approved {who}; it runs once the connector is ready.",
    ja: "✅ {who}許可されました。コネクターの準備ができしだい実行します。",
  },
  executing: { en: "⚙️ Running (approved {who})…", ja: "⚙️ 実行しています（{who}許可）…" },
  succeeded: { en: "✅ Done (approved {who}).", ja: "✅ 実行しました（{who}許可）。" },
  failed: { en: "⚠️ Failed: {reason}", ja: "⚠️ 失敗しました: {reason}" },
  failedApproved: {
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
  byHere: { en: "by <@{person}> in Discord", ja: "<@{person}> が Discord で" },
  byChannel: { en: "by {person} in {channel}", ja: "{channel} で {person} が" },
  requested: { en: "Requested {at} · expires {expires}", ja: "依頼 {at} · 期限 {expires}" },
  truncated: {
    en: "The text is cut here; the bot's page in the Web UI shows all of it.",
    ja: "本文はここで切っています。全文は Web UI のボットの画面で確認できます。",
  },
  result: { en: "Result", ja: "結果" },
  notApprover: {
    en: "Only the bot's owners can decide its actions. They are listed under Owners in the bot's Discord settings.",
    ja: "このボットの操作を判断できるのはオーナーだけです。オーナーはボットの Discord の設定の「オーナー」に入っている人です。",
  },
  gone: {
    en: "This action is no longer kept; the bot's page in the Web UI shows its actions.",
    ja: "この操作はもう記録に残っていません。操作の一覧は Web UI のボットの画面で確認できます。",
  },
  digestTitle: {
    en: "📋 Pending approvals of {bot} ({count})",
    ja: "📋 {bot} の承認待ち（{count} 件）",
  },
  digestEmpty: { en: "No pending approvals.", ja: "承認待ちはありません。" },
  digestExpires: { en: "expires {expires}", ja: "期限 {expires}" },
  digestMore: {
    en: "…and {count} more: the bot's page in the Web UI shows them all.",
    ja: "…ほか {count} 件（Web UI のボットの画面ですべて確認できます）",
  },
  digestHint: {
    en: "Oldest first. A title opens its card, with Approve and Reject.",
    ja: "古い順です。タイトルからそれぞれのカード（許可・拒否）を開けます。",
  },
  pendingNotApprover: {
    en: "Only the bot's owners can see its pending actions. They are listed under Owners in the bot's Discord settings.",
    ja: "承認待ちの操作を見られるのは、このボットのオーナーだけです。オーナーはボットの Discord の設定の「オーナー」に入っている人です。",
  },
  closing: {
    en: "The bot is reconnecting to Discord; try again in a moment.",
    ja: "ボットが Discord に接続し直しています。少し待ってからもう一度押してください。",
  },
} as const satisfies Record<string, Texts>

export type ActionTextKey = keyof typeof TEXTS

export function actionText(
  key: ActionTextKey,
  locale: DiscordLocale,
  params: Record<string, string | number> = {},
): string {
  return TEXTS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}
