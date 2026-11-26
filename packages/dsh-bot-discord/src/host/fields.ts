import type { BotChannelField, BotChannelValuesOf } from "@1outres/dsh-bot-core"

export const HOME_SOURCE = "home"
export const OWNERS_SOURCE = "owners"

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
    agent: {
      note: "The token of your own Discord bot; set only by your owner, and you never see it.",
    },
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
    agent: {
      note: 'Where you live in Discord: "dm" for direct messages with your one owner, or "<server id>:<channel id>" for a server channel where everyone who sees it talks with you and sees what you post. Changing it empties the owners, so pass the new owners in the same change.',
      change: "approve",
    },
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
    agent: {
      note: "Your owners in Discord, by Discord user id: only their messages carry the owner mark, and only they can approve and decide your actions there. Exactly one in direct messages.",
      change: "approve",
    },
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
    agent: {
      note: "The language of your own notices and cards in Discord (failed replies, approvals, questions, connector actions); your replies follow the person you answer.",
      change: "free",
    },
  },
] as const satisfies readonly BotChannelField[]

export type DiscordSettings = BotChannelValuesOf<typeof DISCORD_FIELDS>

export const DISCORD_SETTINGS_VERSION = 2
