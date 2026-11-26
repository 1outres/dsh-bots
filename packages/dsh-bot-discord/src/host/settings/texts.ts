import type { BotChannelText } from "@1outres/dsh-bot-core"

/** What the settings form shows from Discord: option labels, reasons, warnings. */
export const SETTINGS_TEXTS = {
  directMessages: { en: "Direct messages", ja: "ダイレクトメッセージ" },
  directMessagesDetail: {
    en: "One person, the owner, in DMs with the bot",
    ja: "1 人（オーナー）がボットとの DM で使う",
  },
  channelDetail: {
    en: "Everyone who can see this channel talks with the bot",
    ja: "このチャンネルを見られる全員がボットと話す",
  },
  appOwner: { en: "Owner of the application", ja: "アプリケーションの所有者" },
  noToken: { en: "Set the bot token first.", ja: "先にボットのトークンを設定してください。" },
  noHome: { en: "Choose the home first.", ja: "先にホームを選んでください。" },
  tokenRejected: {
    en: "Discord rejected the bot token. Reset it in the Developer Portal and set it again.",
    ja: "Discord がボットのトークンを受け付けませんでした。Developer Portal でトークンを発行し直して設定してください。",
  },
  unreachable: {
    en: "Could not read from Discord: {message}",
    ja: "Discord から読み込めませんでした: {message}",
  },
  membersIntentOff: {
    en: "Turn on Server Members Intent (Developer Portal > Bot > Privileged Gateway Intents) to list the channel's members.",
    ja: "チャンネルのメンバーを一覧するには、Server Members Intent をオンにしてください（Developer Portal > Bot > Privileged Gateway Intents）。",
  },
  messageContentOff: {
    en: "Message Content Intent is off (Developer Portal > Bot > Privileged Gateway Intents): the bot cannot read what people write in its home channel, and Discord refuses to connect it.",
    ja: "Message Content Intent がオフです（Developer Portal > Bot > Privileged Gateway Intents）。ボットはホームチャンネルの発言を読めず、Discord は接続を拒みます。",
  },
  membersOff: {
    en: "Server Members Intent is off (Developer Portal > Bot > Privileged Gateway Intents): owners cannot be listed, and Discord refuses to connect the bot.",
    ja: "Server Members Intent がオフです（Developer Portal > Bot > Privileged Gateway Intents）。オーナーの候補を一覧できず、Discord は接続を拒みます。",
  },
  invite: { en: "Invite the bot to a server", ja: "ボットをサーバーに招待" },
  portal: { en: "The bot in the Developer Portal", ja: "Developer Portal のボット" },
  oneOwner: {
    en: "In direct messages the bot has exactly one owner, the person it talks with. Keep one owner, or choose a server channel as the home.",
    ja: "ダイレクトメッセージでは、オーナーはボットと話すちょうど 1 人です。オーナーを 1 人にするか、ホームにサーバーのチャンネルを選んでください。",
  },
  homeGone: {
    en: "The bot cannot see the home channel, or cannot post and read its history there. Invite it to the server or give it access to the channel.",
    ja: "ボットがホームのチャンネルを見られないか、投稿や履歴の読み込みができません。サーバーに招待するか、チャンネルへのアクセスを与えてください。",
  },
  ownerOutside: {
    en: "{who} cannot see the home channel. Owners must be people who can see it.",
    ja: "{who} はホームのチャンネルを見られません。オーナーはチャンネルを見られる人にしてください。",
  },
  ownerNotMember: {
    en: "{who} is not a member of the home channel's server.",
    ja: "{who} はホームのチャンネルのサーバーのメンバーではありません。",
  },
} as const satisfies Record<string, BotChannelText>

export function settingsText(
  key: keyof typeof SETTINGS_TEXTS,
  params: Record<string, string> = {},
): BotChannelText {
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
  const text: BotChannelText = SETTINGS_TEXTS[key]
  return { en: fill(text.en), ...(text.ja === undefined ? {} : { ja: fill(text.ja) }) }
}
