import type {
  BotChannelText,
  BotCommandOutcome,
  BotConversationStatus,
  BotDeliveryFailure,
  BotTurnState,
} from "@1outres/dsh-bot-core"

export type MatrixLocale = "en" | "ja"

export const localeOf = (language: string): MatrixLocale => (language === "ja" ? "ja" : "en")

export type Texts = { readonly [Locale in MatrixLocale]: string }

export function fill(
  texts: Texts,
  locale: MatrixLocale,
  params: Record<string, string | number> = {},
): string {
  return texts[locale].replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export const pickText = (value: BotChannelText, locale: MatrixLocale): string =>
  locale === "ja" ? (value.ja ?? value.en) : value.en

export function turnNotice(turn: BotTurnState, locale: MatrixLocale): string | undefined {
  switch (turn.phase) {
    case "started":
    case "completed":
      return undefined
    case "failed":
      return `⚠️ ${fill({ en: "The reply failed", ja: "応答に失敗しました" }, locale)}: ${turn.message}`
    case "cancelled":
      return turn.by === "user"
        ? fill({ en: "⏹️ Stopped.", ja: "⏹️ 停止しました。" }, locale)
        : fill({ en: "⏹️ The reply was interrupted.", ja: "⏹️ 応答が中断されました。" }, locale)
  }
}

export const deliveryFailureText = (failure: BotDeliveryFailure, locale: MatrixLocale): string =>
  `⚠️ ${fill({ en: "Not delivered", ja: "届けられませんでした" }, locale)}: ${failure.message}`

function statusText(status: BotConversationStatus, locale: MatrixLocale): string {
  const busy =
    status.activity === "running"
      ? fill({ en: "🟢 Working on a reply", ja: "🟢 応答中" }, locale)
      : fill({ en: "⚪ Idle", ja: "⚪ 待機中" }, locale)
  if (!status.loaded) {
    return `${busy}\n${fill(
      {
        en: "The Main session is not loaded yet (it starts with the next message).",
        ja: "Main セッションはまだ読み込まれていません（次のメッセージで起動します）。",
      },
      locale,
    )}`
  }
  const model =
    status.model === undefined
      ? fill({ en: "unknown", ja: "不明" }, locale)
      : `${status.model.provider} / ${status.model.model}${status.model.reasoningEffort === undefined ? "" : ` (${status.model.reasoningEffort})`}`
  return [
    busy,
    `${fill({ en: "Model", ja: "モデル" }, locale)}: ${model}`,
    `${fill({ en: "Queued messages", ja: "待機中のメッセージ" }, locale)}: ${status.queued}`,
  ].join("\n")
}

export function commandText(outcome: BotCommandOutcome, locale: MatrixLocale): string {
  if (!outcome.ok) return `⚠️ ${outcome.message}`
  const { result } = outcome
  switch (result.command) {
    case "stop":
      return result.outcome === "stopped"
        ? fill({ en: "⏹️ Stopping the current turn.", ja: "⏹️ 実行中の処理を止めています。" }, locale)
        : fill({ en: "Nothing is running.", ja: "実行中の処理はありません。" }, locale)
    case "status":
      return statusText(result.status, locale)
    case "new":
      return result.outcome === "started"
        ? fill(
            {
              en: "🆕 Started a new Main session. The previous conversation is archived and kept.",
              ja: "🆕 新しい Main セッションを始めました。これまでの会話はアーカイブして残します。",
            },
            locale,
          )
        : fill(
            {
              en: "The Main session has no conversation yet, so it already is a new one.",
              ja: "Main セッションにはまだ会話が無いので、すでに新しいセッションです。",
            },
            locale,
          )
  }
}

export const OWNERS_ONLY: Texts = {
  en: "Only the bot's owners can answer this. They are listed under Owners in the bot's Matrix settings.",
  ja: "これに答えられるのはボットのオーナーだけです。オーナーはボットの Matrix の設定の「オーナー」に入っている人です。",
}

export const PENDING_HELP: Texts = {
  en: "List the connector actions waiting for a decision (the bot's owners only)",
  ja: "判断を待っているコネクターの操作を一覧します（ボットのオーナーのみ）",
}

export const HELP_HELP: Texts = { en: "List these commands", ja: "このコマンドの一覧を出します" }

export const HELP_HEAD: Texts = { en: "Commands:", ja: "コマンド:" }
