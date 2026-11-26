import type { BotChannelText } from "@1outres/dsh-bot-core"
import type { DiscordProfileRefusal } from "../discord"
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, type UsernameCheck } from "./username"

type Refused = Exclude<UsernameCheck, { readonly ok: true }>

export function usernameProblem(name: string, check: Refused): BotChannelText {
  switch (check.reason) {
    case "length":
      return {
        en: `Discord takes a username of ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters, so the name “${name}” was not used there.`,
        ja: `Discord のユーザー名は ${USERNAME_MIN_LENGTH}〜${USERNAME_MAX_LENGTH} 文字なので、名前「${name}」は使えませんでした。`,
      }
    case "part":
      return {
        en: `Discord takes no username with “${check.part}”, so the name “${name}” was not used there.`,
        ja: `Discord のユーザー名には「${check.part}」を使えないので、名前「${name}」は使えませんでした。`,
      }
    case "reserved":
      return {
        en: `Discord keeps the username “${name}” for itself, so the name was not used there.`,
        ja: `「${name}」は Discord が予約しているユーザー名なので、使えませんでした。`,
      }
  }
}

export function refusalProblem(
  part: "username" | "avatar",
  refusal: DiscordProfileRefusal,
): BotChannelText {
  if (refusal.kind === "rate-limited") {
    return part === "username"
      ? {
          en: "Discord refused to change the username now: it allows only a few changes an hour. It is tried again at the next change or connection.",
          ja: "Discord が今はユーザー名を変更させませんでした（1 時間に数回までです）。次に名前を変えたときか、次に接続したときにもう一度試します。",
        }
      : {
          en: "Discord refused to change the avatar now: it was changed too often. It is tried again at the next change or connection.",
          ja: "Discord が今はアバターを変更させませんでした（変更が多すぎます）。次に変えたときか、次に接続したときにもう一度試します。",
        }
  }
  return part === "username"
    ? {
        en: `Discord refused the username: ${refusal.message}`,
        ja: `Discord がユーザー名を受け付けませんでした: ${refusal.message}`,
      }
    : {
        en: `Discord refused the avatar: ${refusal.message}`,
        ja: `Discord がアバターを受け付けませんでした: ${refusal.message}`,
      }
}

export function unreachableProblem(message: string): BotChannelText {
  return {
    en: `The name and avatar could not be sent to Discord: ${message}`,
    ja: `名前とアバターを Discord に送れませんでした: ${message}`,
  }
}
