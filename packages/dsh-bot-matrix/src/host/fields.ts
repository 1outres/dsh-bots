import type { BotChannelField, BotChannelValuesOf } from "@1outres/dsh-bot-core"
import { MXID_PATTERN, ROOM_ID_PATTERN } from "./ids"

export const HOME_SOURCE = "home"
export const OWNERS_SOURCE = "owners"
export const DM_HOME = "dm"

export const MATRIX_FIELDS = [
  {
    kind: "pick",
    key: "home",
    label: { en: "Home", ja: "ホーム" },
    description: {
      en: "Where the bot lives in Matrix. Direct chat: one person, the owner, talks with it there. A room: everyone in the room talks with it there, and everything the bot posts goes there, including the contents of connector actions waiting for approval (an email's text…) and credential incident reports, which everyone in the room sees. Encrypted rooms cannot be a home.",
      ja: "Matrix でのボットの居場所。ダイレクトチャット: 1 人（オーナー）がそこで話します。部屋: 部屋の全員がそこで話し、ボットが出すものはすべてそこに出ます。承認を待つコネクターの操作の中身（メールの本文など）やログイン情報の漏洩の報告も含まれ、部屋の全員に見えます。暗号化された部屋はホームにできません。",
    },
    required: true,
    source: HOME_SOURCE,
    clears: ["approvers"],
    maxLength: 255,
    pattern: `${DM_HOME}|${ROOM_ID_PATTERN}`,
    agent: {
      note: 'Where you live in Matrix: "dm" for a direct chat with your one owner, or a room id (!…) where everyone in the room talks with you and sees what you post. Changing it empties the owners, so pass the new owners in the same change.',
      change: "approve",
    },
  },
  {
    kind: "list",
    key: "approvers",
    label: { en: "Owners", ja: "オーナー" },
    description: {
      en: "The bot's owners: the people who can give it instructions and approve its connector actions. In a direct chat, exactly one person, the one the bot talks with. In a room, members of it; only they can approve, review plans and decide connector actions there (the Web UI can always decide them too).",
      ja: "ボットのオーナー（指示を出し、コネクターの操作を承認できる人）。ダイレクトチャットでは話し相手のちょうど 1 人。部屋ではその部屋のメンバーから選び、承認・プランの確認・コネクターの操作の判断はこの人たちだけができます（Web UI ではいつでも判断できます）。",
    },
    minItems: 1,
    maxItems: 10,
    item: { maxLength: 255, pattern: MXID_PATTERN, source: OWNERS_SOURCE },
    agent: {
      note: "Your owners in Matrix, by user id (@name:server): only their messages carry the owner mark, and only they can approve and decide your actions there. Exactly one in a direct chat.",
      change: "approve",
    },
  },
  {
    kind: "text",
    key: "language",
    label: { en: "Notice language", ja: "通知の言語" },
    description: {
      en: "Language of the bot's own texts at its home (notices, cards, command answers): en or ja. Empty is English. Matrix has no per-user language, so everything the bot itself writes follows this.",
      ja: "ホームでのボット自身の文言（通知、カード、コマンドの答え）の言語: en か ja。空欄は英語。Matrix にはユーザーごとの言語が無いので、ボット自身が書くものはすべてこれに従います。",
    },
    required: false,
    maxLength: 2,
    choices: [
      { value: "", label: { en: "Default (English)", ja: "既定（英語）" } },
      { value: "en", label: { en: "English", ja: "English" } },
      { value: "ja", label: { en: "日本語", ja: "日本語" } },
    ],
    agent: {
      note: "The language of your own notices and cards in Matrix (failed replies, approvals, questions, connector actions); your replies follow the person you answer.",
      change: "free",
    },
  },
] as const satisfies readonly BotChannelField[]

export type MatrixSettings = BotChannelValuesOf<typeof MATRIX_FIELDS>
