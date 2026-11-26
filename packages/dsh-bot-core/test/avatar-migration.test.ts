import { describe, expect, it } from "vitest"
import {
  avatarOfRecord,
  isLegacyAvatar,
  LEGACY_EMOJI_CHARACTERS,
  migrateEmojiAvatar,
} from "../src/host/avatar-migration"
import { BOT_CHARACTERS } from "../src/shared/avatar"

const LEGACY_EMOJI = ["🤖", "🦊", "🐱", "🐙", "🦉", "🐧", "🌟", "🍀"]

describe("migrateEmojiAvatar", () => {
  it("turns the i-th emoji of the old picker into the i-th character, keeping the color", () => {
    expect([...LEGACY_EMOJI_CHARACTERS.keys()]).toEqual(LEGACY_EMOJI)
    for (const [index, emoji] of LEGACY_EMOJI.entries()) {
      expect(migrateEmojiAvatar({ kind: "emoji", emoji, color: "#0EA5E9" }, "Ada")).toEqual({
        kind: "character",
        character: BOT_CHARACTERS[index],
        color: "#0EA5E9",
      })
    }
  })

  it("turns any other emoji into the bot's initial in the same color", () => {
    expect(migrateEmojiAvatar({ kind: "emoji", emoji: "🐳", color: "#EF4444" }, " bob")).toEqual({
      kind: "initial",
      text: "B",
      color: "#EF4444",
    })
    expect(
      migrateEmojiAvatar({ kind: "emoji", emoji: "🤖🤖", color: "#EF4444" }, "ふくろう"),
    ).toEqual({ kind: "initial", text: "ふ", color: "#EF4444" })
  })
})

describe("avatarOfRecord", () => {
  it("migrates a legacy record and passes a current one through", () => {
    expect(
      avatarOfRecord({ name: "Ada", avatar: { kind: "emoji", emoji: "🦉", color: "#10B981" } }),
    ).toEqual({ kind: "character", character: "kitty", color: "#10B981" })
    const current = { kind: "initial", text: "Q", color: "#10B981" } as const
    expect(avatarOfRecord({ name: "Ada", avatar: current })).toBe(current)
  })

  it("tells the legacy kind apart", () => {
    expect(isLegacyAvatar({ kind: "emoji", emoji: "🤖", color: "#6366F1" })).toBe(true)
    expect(isLegacyAvatar({ kind: "character", character: "capsule", color: "#6366F1" })).toBe(
      false,
    )
    expect(isLegacyAvatar({ kind: "image", dataUrl: "data:image/png;base64,AA" })).toBe(false)
  })
})
