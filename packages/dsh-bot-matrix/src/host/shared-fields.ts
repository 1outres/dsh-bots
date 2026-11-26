import type { BotChannelSharedField, BotChannelValuesOf } from "@1outres/dsh-bot-core"
import { MXID_PATTERN, PREFIX_PATTERN } from "./ids"
import { SERVER_CHOICES } from "./servers"

export const MATRIX_SHARED_FIELDS = [
  {
    kind: "text",
    key: "server",
    label: { en: "Homeserver software", ja: "homeserver の実装" },
    description: {
      en: "Which homeserver runs at the URL below. It is checked against the server; nothing is guessed.",
      ja: "下の URL で動いている homeserver の実装。実物と合うかを確かめます（推測はしません）。",
    },
    required: true,
    maxLength: 32,
    choices: SERVER_CHOICES,
  },
  {
    kind: "text",
    key: "homeserver",
    label: { en: "Homeserver URL", ja: "homeserver の URL" },
    description: {
      en: "The Client-Server API URL, such as https://matrix.example.org. Only this URL is used (no .well-known lookup).",
      ja: "Client-Server API の URL（例 https://matrix.example.org）。この URL だけを使います（.well-known は読みません）。",
    },
    required: true,
    maxLength: 512,
    pattern: "https?://[^\\s/?#]+(/[^\\s?#]*)?",
    placeholder: "https://matrix.example.org",
  },
  {
    kind: "secret",
    key: "asToken",
    label: { en: "Application service token", ja: "Application Service のトークン" },
    description: {
      en: "The as_token of the registration file (make one with openssl rand -hex 32 and put it in both places).",
      ja: "登録ファイルの as_token（openssl rand -hex 32 などで作り、登録ファイルとここの両方に入れます）。",
    },
    required: true,
    maxLength: 256,
  },
  {
    kind: "text",
    key: "prefix",
    label: { en: "User name prefix", ja: "ユーザー名の接頭辞" },
    description: {
      en: "Each bot's Matrix user is @<prefix>_<bot id>; the application service itself is @<prefix>. It must match sender_localpart and the users namespace of the registration file.",
      ja: "ボットの Matrix ユーザーは @<接頭辞>_<ボット ID>、Application Service 自身は @<接頭辞> です。登録ファイルの sender_localpart と users の名前空間に合わせます。",
    },
    required: true,
    maxLength: 32,
    pattern: PREFIX_PATTERN,
    placeholder: "dshbots",
  },
  {
    kind: "text",
    key: "defaultOwner",
    label: { en: "Default owner", ja: "既定のオーナー" },
    description: {
      en: "The Matrix user new bots talk with in a direct chat, such as @alice:example.org. Empty: new bots do not turn Matrix on by themselves.",
      ja: "新しいボットが DM で話す Matrix のユーザー（例 @alice:example.org）。空なら新しいボットで自動ではオンにしません。",
    },
    required: false,
    maxLength: 255,
    pattern: MXID_PATTERN,
    placeholder: "@alice:example.org",
  },
] as const satisfies readonly BotChannelSharedField[]

export type MatrixShared = BotChannelValuesOf<typeof MATRIX_SHARED_FIELDS>
