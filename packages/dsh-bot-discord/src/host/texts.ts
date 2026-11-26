import type {
  BotCommandOutcome,
  BotConversationStatus,
  BotDeliveryFailure,
  BotTurnState,
} from "@1outres/dsh-bot-core"

export type DiscordLocale = "en" | "ja"

export function localeOf(discordLocale: string): DiscordLocale {
  return discordLocale.toLowerCase().startsWith("ja") ? "ja" : "en"
}

export function settingsLocale(language: string): DiscordLocale {
  return language === "ja" ? "ja" : "en"
}

type Texts = { readonly [K in DiscordLocale]: string }
const pick = (texts: Texts, locale: DiscordLocale) => texts[locale]

export function turnNotice(turn: BotTurnState, locale: DiscordLocale): string | undefined {
  switch (turn.phase) {
    case "started":
    case "completed":
      return undefined
    case "failed":
      return `⚠️ ${pick({ en: "The reply failed", ja: "応答に失敗しました" }, locale)}: ${turn.message}`
    case "cancelled":
      return turn.by === "user"
        ? pick({ en: "⏹️ Stopped.", ja: "⏹️ 停止しました。" }, locale)
        : pick({ en: "⏹️ The reply was interrupted.", ja: "⏹️ 応答が中断されました。" }, locale)
  }
}

export function deliveryFailureText(failure: BotDeliveryFailure, locale: DiscordLocale): string {
  return `⚠️ ${pick({ en: "Not delivered", ja: "届けられませんでした" }, locale)}: ${failure.message}`
}

function statusText(status: BotConversationStatus, locale: DiscordLocale): string {
  const busy =
    status.activity === "running"
      ? pick({ en: "🟢 Working on a reply", ja: "🟢 応答中" }, locale)
      : pick({ en: "⚪ Idle", ja: "⚪ 待機中" }, locale)
  if (!status.loaded) {
    return [
      busy,
      pick(
        {
          en: "The Main session is not loaded yet (it starts with the next message).",
          ja: "Main セッションはまだ読み込まれていません（次のメッセージで起動します）。",
        },
        locale,
      ),
    ].join("\n")
  }
  const model =
    status.model === undefined
      ? pick({ en: "unknown", ja: "不明" }, locale)
      : `${status.model.provider} / ${status.model.model}${status.model.reasoningEffort === undefined ? "" : ` (${status.model.reasoningEffort})`}`
  return [
    busy,
    `${pick({ en: "Model", ja: "モデル" }, locale)}: ${model}`,
    `${pick({ en: "Queued messages", ja: "待機中のメッセージ" }, locale)}: ${status.queued}`,
  ].join("\n")
}

export function commandText(outcome: BotCommandOutcome, locale: DiscordLocale): string {
  if (!outcome.ok) return `⚠️ ${outcome.message}`
  const { result } = outcome
  switch (result.command) {
    case "stop":
      return result.outcome === "stopped"
        ? pick({ en: "⏹️ Stopping the current turn.", ja: "⏹️ 実行中の処理を止めています。" }, locale)
        : pick({ en: "Nothing is running.", ja: "実行中の処理はありません。" }, locale)
    case "status":
      return statusText(result.status, locale)
    case "new":
      return result.outcome === "started"
        ? pick(
            {
              en: "🆕 Started a new Main session. The previous conversation is archived and kept.",
              ja: "🆕 新しい Main セッションを始めました。これまでの会話はアーカイブして残します。",
            },
            locale,
          )
        : pick(
            {
              en: "The Main session has no conversation yet, so it already is a new one.",
              ja: "Main セッションにはまだ会話が無いので、すでに新しいセッションです。",
            },
            locale,
          )
  }
}

export function notHomeText(locale: DiscordLocale): string {
  return pick(
    {
      en: "This bot is used in its home only (the channel or the DM its settings name).",
      ja: "このボットはホーム（設定で選んだチャンネルか DM）でだけ使えます。",
    },
    locale,
  )
}

export function ownersOnlyText(locale: DiscordLocale): string {
  return pick(
    {
      en: "Only the bot's owners can answer this. They are listed under Owners in the bot's Discord settings.",
      ja: "これに答えられるのはボットのオーナーだけです。オーナーはボットの Discord の設定の「オーナー」に入っている人です。",
    },
    locale,
  )
}

export function unknownCommandText(locale: DiscordLocale): string {
  return pick(
    { en: "This command is not offered any more.", ja: "このコマンドは現在提供されていません。" },
    locale,
  )
}
