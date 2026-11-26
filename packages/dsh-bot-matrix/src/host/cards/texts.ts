import { fill, type MatrixLocale, type Texts } from "../texts"

const TEXTS = {
  question: { en: "Question", ja: "質問" },
  approval: { en: "Approval needed", ja: "承認が必要です" },
  planReview: { en: "Plan review", ja: "プランの確認" },
  howSingle: {
    en: "React with a number, or reply to this message with a number or your own answer. Reply - to skip.",
    ja: "番号のリアクションか、このメッセージへの返信で番号か自由な答えを送ってください。- でスキップします。",
  },
  howMulti: {
    en: "Reply to this message with the numbers (1,3), or your own answer. Reply - to skip.",
    ja: "このメッセージに番号（1,3 など）か自由な答えで返信してください。- でスキップします。",
  },
  howText: {
    en: "Reply to this message with your answer. Reply - to skip.",
    ja: "このメッセージに答えを返信してください。- でスキップします。",
  },
  howHold: { en: "React ⏸️ to make the bot wait for you.", ja: "⏸️ でボットに回答を待たせます。" },
  howApproval: { en: "React {keys}.", ja: "{keys} でリアクションしてください。" },
  howPlan: {
    en: "React ✅ to approve. React ❌, or reply with what should change, to send it back.",
    ja: "✅ で承認します。❌ か、直してほしい点の返信で差し戻します。",
  },
  allowOnce: { en: "allow once", ja: "1 回だけ許可" },
  always: { en: "always allow", ja: "常に許可" },
  reject: { en: "reject", ja: "拒否" },
  approve: { en: "approve", ja: "承認" },
  waitHeld: { en: "⏸️ Waiting until you answer.", ja: "⏸️ 回答するまで待っています。" },
  waitContinued: {
    en: "▶️ The bot went on; you can still answer.",
    ja: "▶️ ボットは作業を続けています。まだ回答できます。",
  },
  waitCounting: {
    en: "⏳ The bot goes on at {at} unless answered.",
    ja: "⏳ 回答がなければ {at} にボットは作業を続けます。",
  },
  answers: { en: "Answers so far", ja: "ここまでの回答" },
  skipped: { en: "skipped", ja: "スキップ" },
  delegated: {
    en: "A subagent of the bot's Main session asks.",
    ja: "ボットの Main セッションのサブエージェントからの要求です。",
  },
  answeredHere: { en: "✅ Answered in Matrix", ja: "✅ Matrix で回答済み" },
  answeredWeb: { en: "✅ Answered in the Web UI", ja: "✅ Web UI で回答済み" },
  answeredMain: { en: "✅ Answered by the Main session", ja: "✅ Main セッションが回答済み" },
  answeredElsewhere: { en: "✅ Answered in {channel}", ja: "✅ {channel} で回答済み" },
  withdrawn: {
    en: "⏹️ Withdrawn: the bot no longer waits for this answer.",
    ja: "⏹️ 取り下げられました: ボットはこの回答を待っていません。",
  },
  refused: { en: "⚠️ Not sent: {message}", ja: "⚠️ 送信できませんでした: {message}" },
  approved: { en: "approved", ja: "承認" },
  changesRequested: { en: "changes requested", ja: "修正を依頼" },
} as const satisfies Record<string, Texts>

export type CardTextKey = keyof typeof TEXTS

export const cardText = (
  key: CardTextKey,
  locale: MatrixLocale,
  params: Record<string, string | number> = {},
) => fill(TEXTS[key], locale, params)
