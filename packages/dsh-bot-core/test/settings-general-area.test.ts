import { describe, expect, it } from "vitest"
import { createGeneralArea } from "../src/host/settings/areas/general"
import type { BotAvatar } from "../src/shared/avatar"
import type { BotView } from "../src/shared/bots"

const botWith = (avatar: BotAvatar): BotView => ({
  id: "a",
  name: "Ada",
  avatar,
  mainSessionId: "m",
  mainStartedAt: 1,
  sessionIds: [],
  formerMainIds: [],
  timezone: "UTC",
  createdAt: 1,
})

const avatarEntry = async (avatar: BotAvatar) => {
  const area = createGeneralArea({
    bot: () => botWith(avatar),
    update: async () => botWith(avatar),
  })
  return (await area.entries("a", new AbortController().signal)).find(
    (entry) => entry.key === "avatar",
  )?.value
}

describe("general settings area", () => {
  it("names the bot's robot character, initial or image", async () => {
    expect(await avatarEntry({ kind: "character", character: "kitty", color: "#6366F1" })).toEqual({
      raw: "character",
      shown: { en: "Cat ears (robot character)", ja: "ネコミミ（ロボットのキャラクター）" },
    })
    expect(await avatarEntry({ kind: "initial", text: "A", color: "#6366F1" })).toEqual({
      raw: "initial",
      shown: { en: "A (initials)", ja: "A（文字）" },
    })
    expect(await avatarEntry({ kind: "image", dataUrl: "data:image/png;base64,AA" })).toEqual({
      raw: "image",
      shown: { en: "An image", ja: "画像" },
    })
  })
})
