import type { BotChannelField, BotChannelValuesOf } from "@1outres/dsh-bot-core"

/** The option sources of the Discord settings. */
export const HOME_SOURCE = "home"
export const OWNERS_SOURCE = "owners"

/** A bot's Discord settings: bot-core renders them in the bot's Channels dialog and stores the token as a secret. */
export const DISCORD_FIELDS = [
  {
    kind: "secret",
    key: "token",
    label: { en: "Bot token", ja: "ボットのトークン" },
    description: {
      en: "Discord Developer Portal > your application > Bot > Reset Token.",
      ja: "Discord Developer Portal > アプリケーション > Bot > Reset Token で発行します。",
    },
    required: true,
    maxLength: 200,
  },
  {
    kind: "pick",
    key: "home",
    label: { en: "Home", ja: "ホーム" },
    description: {
      en: "Where the bot lives in Discord. Direct messages: one person, the owner, talks with it in DMs. A server channel: everyone who can see that channel talks with it there, and everything the bot posts goes there, including the contents of connector actions waiting for approval (an email's text…) and credential incident reports, which everyone in the channel sees.",
      ja: "Discord でのボットの居場所。ダイレクトメッセージ: 1 人（オーナー）が DM で話します。サーバーのチャンネル: そのチャンネルを見られる人全員がそこで話し、ボットが出すものはすべてそこに出ます。承認を待つコネクターの操作の中身（メールの本文など）やログイン情報の漏洩の報告も含まれ、チャンネルの全員に見えます。",
    },
    required: true,
    source: HOME_SOURCE,
    clears: ["approvers"],
    maxLength: 41,
    pattern: "dm|[0-9]{17,20}:[0-9]{17,20}",
  },
  {
    kind: "list",
    key: "approvers",
    label: { en: "Owners", ja: "オーナー" },
    description: {
      en: "The bot's owners: the people who can give the bot instructions and approve its connector actions (usually just you). In direct messages, exactly one person, the one the bot talks with. In a server channel, people who can see it; the bot treats only their messages as its owner's, and only they can approve, review plans and decide connector actions there (the Web UI can always decide them too).",
      ja: "ボットのオーナー（ボットに指示を出し、コネクターの操作を承認できる人。ふつうはあなただけ）。ダイレクトメッセージでは、ボットと話すちょうど 1 人。サーバーのチャンネルでは、そのチャンネルを見られる人から選びます。ボットはこの人たちの発言だけをオーナーのものとして扱い、承認・プランの確認・コネクターの操作の判断はこの人たちだけができます（Web UI ではいつでも判断できます）。",
    },
    minItems: 1,
    maxItems: 10,
    item: { maxLength: 20, pattern: "[0-9]{17,20}", source: OWNERS_SOURCE },
  },
  {
    kind: "text",
    key: "language",
    label: { en: "Notice language", ja: "通知の言語" },
    description: {
      en: "Language of the bot's own texts at its home (a failed or stopped reply, an undelivered message, question, approval, plan review, connector action and credential incident cards): en or ja. Empty is English. Command answers and private refusals follow each user's Discord language.",
      ja: "ホームでのボット自身の文言（応答の失敗・停止、届けられなかったメッセージ、質問・承認・プラン確認・コネクターの操作・ログイン情報の漏洩のカード）の言語: en か ja。空欄は英語。コマンドの返答と本人だけに見える断りは各ユーザーの Discord の言語に従います。",
    },
    required: false,
    maxLength: 2,
    choices: [
      { value: "", label: { en: "Default (English)", ja: "既定（英語）" } },
      { value: "en", label: { en: "English", ja: "English" } },
      { value: "ja", label: { en: "日本語", ja: "日本語" } },
    ],
  },
] as const satisfies readonly BotChannelField[]

export type DiscordSettings = BotChannelValuesOf<typeof DISCORD_FIELDS>

/** The shape of the settings: version 2 replaced the allowed users with the home. */
export const DISCORD_SETTINGS_VERSION = 2
