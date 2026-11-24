const EN = {
  "status.connecting": "Connecting…",
  "status.paused": "Paused",
  "status.disconnected": "Disconnected",
  "status.reconnecting": "Reconnecting in {seconds} s",
  "holder.agent": "The bot is operating",
  "holder.self": "You are operating",
  "holder.other": "Operating in another window",
  take: "Take over",
  "take.other": "Take over here",
  release: "Hand back",
  reconnect: "Reconnect",
  decline: "Decline",
  ctrlAltDel: "Send Ctrl+Alt+Del",
  "request.title": "The bot asks you to take over",
  "warning.typing": "What you type here, passwords included, reaches the bot's VM.",
  screen: "The bot's desktop",
}

export type MessageKey = keyof typeof EN

const JA: { readonly [Key in MessageKey]: string } = {
  "status.connecting": "接続しています…",
  "status.paused": "一時停止中",
  "status.disconnected": "切断しました",
  "status.reconnecting": "{seconds} 秒後に再接続",
  "holder.agent": "ボットが操作中",
  "holder.self": "あなたが操作中",
  "holder.other": "別の画面で操作中",
  take: "引き継ぐ",
  "take.other": "ここで引き継ぐ",
  release: "返す",
  reconnect: "再接続",
  decline: "断る",
  ctrlAltDel: "Ctrl+Alt+Del を送る",
  "request.title": "ボットが操作の引き継ぎを頼んでいます",
  "warning.typing": "ここで入力したもの（パスワードも）はボットの VM に届きます",
  screen: "ボットのデスクトップ",
}

export const en: Readonly<Record<string, string>> = EN
export const ja: Readonly<Record<string, string>> = JA
