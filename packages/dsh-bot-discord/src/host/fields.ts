import type { BotChannelField, BotChannelValuesOf } from "@1outres/dsh-bot-core"

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
    kind: "list",
    key: "users",
    label: { en: "Allowed users", ja: "会話できるユーザー" },
    description: {
      en: "Discord user IDs (Developer Mode > right-click a user > Copy User ID). Only their direct messages reach the bot, and the bot's replies go to each of them.",
      ja: "Discord のユーザー ID（開発者モード > ユーザーを右クリック > ユーザー ID をコピー）。この人たちの DM だけがボットに届き、ボットの返信はそれぞれの DM に送られます。",
    },
    minItems: 1,
    maxItems: 25,
    item: { maxLength: 20, pattern: "[0-9]{17,20}", placeholder: "123456789012345678" },
  },
  {
    kind: "list",
    key: "approvers",
    label: { en: "Owners", ja: "オーナー" },
    description: {
      en: "Discord user IDs of the bot's owners: the people who can give the bot instructions and approve its connector actions (usually just you). The bot treats only their messages as its owner's; to talk with it they also need to be Allowed users. Connector actions that ask first (sending an email…) are posted to their DMs with Approve and Reject, and only they can decide them in Discord (the Web UI can always decide them too).",
      ja: "ボットのオーナー（ボットに指示を出し、コネクターの操作を承認できる人。ふつうはあなただけ）の Discord のユーザー ID。ボットはこの人たちの発言だけをオーナーのものとして扱います。ボットと会話するには「会話できるユーザー」にも入れてください。確認が必要なコネクターの操作（メールの送信など）はこの人たちの DM に許可・拒否のボタン付きで届き、Discord で判断できるのはこの人たちだけです（Web UI ではいつでも判断できます）。",
    },
    minItems: 0,
    maxItems: 10,
    item: { maxLength: 20, pattern: "[0-9]{17,20}", placeholder: "123456789012345678" },
  },
  {
    kind: "text",
    key: "language",
    label: { en: "Notice language", ja: "通知の言語" },
    description: {
      en: "Language of the bot's own texts in DMs (a failed or stopped reply, an undelivered message, question, approval, plan review and connector action cards): en or ja. Empty is English. Command answers and private refusals follow each user's Discord language.",
      ja: "DM でのボット自身の文言（応答の失敗・停止、届けられなかったメッセージ、質問・承認・プラン確認・コネクターの操作のカード）の言語: en か ja。空欄は英語。コマンドの返答と本人だけに見える拒否は各ユーザーの Discord の言語に従います。",
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
