import type { DiscordLocale } from "../texts"

type Texts = { readonly [Locale in DiscordLocale]: string }

const TEXTS = {
  title: { en: "📨 Mail from {address}", ja: "📨 {address} からのメール" },
  pending: {
    en: "⏳ Should the bot read mail from this sender? It expires {expires}.",
    ja: "⏳ この送信元のメールをボットに読ませますか？期限は{expires}です。",
  },
  waiting: { en: "{count} message(s) wait", ja: "{count} 通が待っています" },
  account: { en: "Account", ja: "アカウント" },
  latest: { en: "Latest", ja: "最新" },
  freemail: {
    en: "{domain} is a free mail service, so the domain cannot be allowed as a whole.",
    ja: "{domain} はフリーメールなので、ドメインごとの許可はできません。",
  },
  expiryNote: {
    en: "Unanswered, the waiting mail is dropped when it expires and the sender is asked about again.",
    ja: "答えないまま期限が切れると、待っているメールは捨て、次のメールでまた聞きます。",
  },
  "allow-address": { en: "Allow address", ja: "アドレスを許可" },
  "allow-domain": { en: "Allow {domain}", ja: "{domain} を許可" },
  "deny-address": { en: "Deny address", ja: "アドレスを拒否" },
  "deny-domain": { en: "Deny {domain}", ja: "{domain} を拒否" },
  answered: { en: "✅ {choice} {who}.", ja: "✅ {who}{choice}。" },
  answeredDeny: { en: "🚫 {choice} {who}.", ja: "🚫 {who}{choice}。" },
  coveredAllow: {
    en: "✅ A rule allowed this sender; the waiting mail went to the bot.",
    ja: "✅ ルールでこの送信元が許可され、待っていたメールをボットに渡しました。",
  },
  coveredDeny: {
    en: "🚫 A rule hid this sender; the waiting mail was dropped.",
    ja: "🚫 ルールでこの送信元が隠され、待っていたメールは捨てました。",
  },
  expired: {
    en: "⌛ Nobody answered; the waiting mail was dropped.",
    ja: "⌛ 誰も答えなかったため、待っていたメールは捨てました。",
  },
  byWeb: { en: "in the Web UI", ja: "Web UI で" },
  byHere: { en: "by <@{person}> in Discord", ja: "<@{person}> が Discord で" },
  byChannel: { en: "by {person} in {channel}", ja: "{channel} で {person} が" },
  gone: {
    en: "This question is no longer kept; the bot's Gmail settings in the Web UI show its senders.",
    ja: "この問い合わせはもう記録に残っていません。送信元は Web UI のボットの Gmail の設定で確認できます。",
  },
  notApprover: {
    en: "Only the bot's owners can answer. They are listed under Owners in the bot's Discord settings.",
    ja: "答えられるのはこのボットのオーナーだけです。オーナーはボットの Discord の設定の「オーナー」に入っている人です。",
  },
  notOffered: {
    en: "That answer is not offered for this sender.",
    ja: "この送信元にはその答えを選べません。",
  },
  closing: {
    en: "The bot is reconnecting to Discord; try again in a moment.",
    ja: "ボットが Discord に接続し直しています。少し待ってからもう一度押してください。",
  },
} as const satisfies Record<string, Texts>

export type InquiryTextKey = keyof typeof TEXTS

export function inquiryText(
  key: InquiryTextKey,
  locale: DiscordLocale,
  params: Record<string, string | number> = {},
): string {
  return TEXTS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}
