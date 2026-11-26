import type { BotApprovalAction, BotChannelText } from "@1outres/dsh-bot-core"
import type { DiscordLocale } from "../texts"

type Texts = { readonly [Locale in DiscordLocale]: string }

const TEXTS = {
  question: { en: "Question", ja: "質問" },
  approval: { en: "Approval needed", ja: "承認が必要です" },
  planReview: { en: "Plan review", ja: "プランの確認" },
  other: { en: "Other…", ja: "その他…" },
  answer: { en: "Answer…", ja: "回答を入力…" },
  skip: { en: "Skip", ja: "スキップ" },
  skipped: { en: "skipped", ja: "スキップ" },
  back: { en: "Back", ja: "戻る" },
  next: { en: "Next", ja: "次へ" },
  submit: { en: "Submit", ja: "送信" },
  takeTime: { en: "Take time", ja: "時間をかける" },
  choose: { en: "Choose…", ja: "選んでください…" },
  chooseMore: { en: "More choices…", ja: "ほかの選択肢…" },
  yourAnswer: { en: "Your answer", ja: "あなたの回答" },
  notAnswered: { en: "not answered yet", ja: "まだ回答していません" },
  tooManyChoices: {
    en: "Discord shows the first 100 choices only; answer with text or in the Web UI for the others.",
    ja: "Discord には最初の 100 個の選択肢だけを表示しています。ほかはテキストか Web UI で回答してください。",
  },
  detailAbove: { en: "(details above)", ja: "（詳細は上にあります）" },
  waitHeld: { en: "⏸️ Waiting until you answer.", ja: "⏸️ 回答するまで待っています。" },
  waitContinued: {
    en: "▶️ The bot went on; you can still answer.",
    ja: "▶️ ボットは作業を続けています。まだ回答できます。",
  },
  sending: { en: "⏳ Sending…", ja: "⏳ 送信しています…" },
  modalTitle: { en: "Your answer", ja: "回答" },
  modalLabel: { en: "Answer", ja: "回答" },
  feedbackTitle: { en: "Request changes", ja: "修正を依頼" },
  feedbackLabel: { en: "What should change? (optional)", ja: "修正してほしい点（任意）" },
  approve: { en: "Approve", ja: "承認" },
  requestChanges: { en: "Request changes…", ja: "修正を依頼…" },
  approved: { en: "approved", ja: "承認" },
  changesRequested: { en: "changes requested", ja: "修正を依頼" },
  delegated: {
    en: "A subagent of the bot's Main session asks.",
    ja: "ボットの Main セッションのサブエージェントからの要求です。",
  },
  answeredHere: { en: "✅ Answered in Discord", ja: "✅ Discord で回答済み" },
  answeredWeb: { en: "✅ Answered in the Web UI", ja: "✅ Web UI で回答済み" },
  answeredMain: { en: "✅ Answered by the Main session", ja: "✅ Main セッションが回答済み" },
  answeredElsewhere: { en: "✅ Answered in {channel}", ja: "✅ {channel} で回答済み" },
  withdrawn: {
    en: "⏹️ Withdrawn: the bot no longer waits for this answer.",
    ja: "⏹️ 取り下げられました: ボットはこの回答を待っていません。",
  },
  notOpen: {
    en: "This is no longer waiting for an answer.",
    ja: "この質問はもう回答を受け付けていません。",
  },
  refused: { en: "⚠️ Not sent: {message}", ja: "⚠️ 送信できませんでした: {message}" },
} as const satisfies Record<string, Texts>

export type InteractionTextKey = keyof typeof TEXTS

export function text(
  key: InteractionTextKey,
  locale: DiscordLocale,
  params: Record<string, string | number> = {},
): string {
  return TEXTS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export function incompleteText(question: number, locale: DiscordLocale): string {
  return locale === "ja"
    ? `⚠️ 先に質問 ${question} に回答してください（スキップもできます）。`
    : `⚠️ Answer question ${question} first (or skip it).`
}

export function countdownText(deadline: number, locale: DiscordLocale): string {
  const at = `<t:${Math.ceil(deadline / 1000)}:R>`
  return locale === "ja" ? `⏳ ${at}にボットは作業を続けます。` : `⏳ The bot goes on ${at}.`
}

const APPROVAL_TEXTS: Readonly<Record<BotApprovalAction, Texts>> = {
  "allow-once": { en: "Allow once", ja: "1 回だけ許可" },
  reject: { en: "Reject", ja: "拒否" },
  always: { en: "Always allow", ja: "常に許可" },
}

export const approvalText = (action: BotApprovalAction, locale: DiscordLocale): string =>
  APPROVAL_TEXTS[action][locale]

export const pickText = (value: BotChannelText, locale: DiscordLocale): string =>
  locale === "ja" ? (value.ja ?? value.en) : value.en
