import type { DiscordLocale } from "../texts"

type Texts = { readonly [Locale in DiscordLocale]: string }

const TEXTS = {
  headlineRedacted: {
    en: "🔒 A secret of one of {bot}'s logins turned up where the bot reads; it was withheld.",
    ja: "🔒 {bot} のログイン情報の秘密が、ボットが読む場所に現れました。伏せてあります。",
  },
  headlineExposed: {
    en: "🚨 {bot}'s model read a secret of one of its logins.",
    ja: "🚨 {bot} のモデルがログイン情報の秘密を読みました。",
  },
  title: { en: "Credential incident", ja: "ログイン情報の漏洩" },
  login: { en: "Login", ja: "ログイン情報" },
  where: { en: "Where", ja: "どこで" },
  when: { en: "When", ja: "いつ" },
  outcome: { en: "Outcome", ja: "結果" },
  toolResult: { en: "in the result of the tool {tool}", ja: "ツール {tool} の結果" },
  toolArguments: {
    en: "in the arguments of the tool {tool} (the call was refused)",
    ja: "ツール {tool} の引数（呼び出しは断りました）",
  },
  anyTool: { en: "(unknown)", ja: "（不明）" },
  assistantMessage: { en: "in a reply the bot wrote", ja: "ボットが書いた返答" },
  inboundMessage: { en: "in a message sent to the bot", ja: "ボットに送られたメッセージ" },
  botContext: {
    en: "in what the bot was handed (a notice, an action's result, notes or skills)",
    ja: "ボットに渡す情報（通知・アクションの結果・メモ・スキル）",
  },
  repeats: { en: "{count} times in all, last {last}", ja: "計 {count} 回、最後は {last}" },
  redacted: {
    en: "Withheld: the value was replaced before the model read it.",
    ja: "伏せました: モデルが読む前に値を置き換えたので、モデルには渡っていません。",
  },
  exposed: {
    en: "Exposed: the model already had the value.",
    ja: "漏れました: モデルが値を読んでいます。",
  },
  changePassword: {
    en: "⚠️ Change the password of {label} now: the model's provider and the session's log may keep it.",
    ja: "⚠️ 今すぐ {label} のパスワードを変更してください。モデルの提供元やセッションのログに残っている可能性があります。",
  },
  changePasskey: {
    en: "⚠️ Replace the passkey of {label} now (remove it at the site and register a new one) and change its password: the model's provider and the session's log may keep it.",
    ja: "⚠️ 今すぐ {label} のパスキーを作り直し（サイトで削除して登録し直す）、パスワードも変更してください。モデルの提供元やセッションのログに残っている可能性があります。",
  },
  changeOtp: {
    en: "⚠️ Set up the one-time passwords of {label} again now and change its password: the model's provider and the session's log may keep it.",
    ja: "⚠️ 今すぐ {label} のワンタイムパスワードを設定し直し、パスワードも変更してください。モデルの提供元やセッションのログに残っている可能性があります。",
  },
  acknowledge: {
    en: "Acknowledge it in the Web UI, under Logins in the bot's settings; the Web UI shows it until then.",
    ja: "Web UI のボットの設定「ログイン情報」で確認してください。確認するまで Web UI に表示され続けます。",
  },
  password: { en: "password", ja: "パスワード" },
  otp: { en: "one-time password", ja: "ワンタイムパスワード" },
  passkey: { en: "passkey", ja: "パスキー" },
} as const satisfies Record<string, Texts>

export type IncidentTextKey = keyof typeof TEXTS

export function incidentText(
  key: IncidentTextKey,
  locale: DiscordLocale,
  params: Record<string, string> = {},
): string {
  return TEXTS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
