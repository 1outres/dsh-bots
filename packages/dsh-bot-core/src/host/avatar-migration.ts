import { type BotAvatar, type BotCharacter, initialOf } from "../shared/avatar"
import type { BotRecord, LegacyEmojiAvatar, StoredAvatar } from "./domain"

export const LEGACY_EMOJI_CHARACTERS: ReadonlyMap<string, BotCharacter> = new Map([
  ["🤖", "capsule"],
  ["🦊", "antenna"],
  ["🐱", "scanner"],
  ["🐙", "ears"],
  ["🦉", "kitty"],
  ["🐧", "twin"],
  ["🌟", "monitor"],
  ["🍀", "sleepy"],
])

export function migrateEmojiAvatar(avatar: LegacyEmojiAvatar, name: string): BotAvatar {
  const character = LEGACY_EMOJI_CHARACTERS.get(avatar.emoji)
  if (character === undefined)
    return { kind: "initial", text: initialOf(name), color: avatar.color }
  return { kind: "character", character, color: avatar.color }
}

export function isLegacyAvatar(avatar: StoredAvatar): avatar is LegacyEmojiAvatar {
  return avatar.kind === "emoji"
}

export function avatarOfRecord(record: Pick<BotRecord, "name" | "avatar">): BotAvatar {
  return isLegacyAvatar(record.avatar)
    ? migrateEmojiAvatar(record.avatar, record.name)
    : record.avatar
}
