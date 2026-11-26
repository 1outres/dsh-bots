import { createHash } from "node:crypto"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { characterSvg, initialSvg } from "../src/host/channels/profile/avatar-svg"
import { createProfileRenderer, PROFILE_AVATAR_SIZE } from "../src/host/channels/profile/render"
import { createSharpRasterizer } from "../src/host/channels/profile/sharp"
import { BOT_CHARACTERS } from "../src/shared/avatar"
import { CHARACTER_SHAPES } from "../src/shared/character-shapes"

const WEBP =
  "data:image/webp;base64,UklGRiICAABXRUJQVlA4WAoAAAAgAAAAAwAAAwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggNAAAADACAJ0BKgQABAAAwBIloAJ0ugH4AfgABGgAAP76IZf/d5qw03f1rf/1o5+uif60c/9ZWAA="

const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")
const renderer = () => createProfileRenderer({ rasterize: createSharpRasterizer(), digest })

async function pixelsOf(png: Uint8Array) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return { data, info }
}

describe("profile avatar SVG", () => {
  it.each(BOT_CHARACTERS)("draws %s from the shared shapes on a full square", (character) => {
    const svg = characterSvg({ kind: "character", character, color: "#EC4899" }, 512)
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="512" height="512" viewBox="0 0 64 64">/,
    )
    expect(svg.match(/<(rect|circle|path) /g)).toHaveLength(CHARACTER_SHAPES[character].length + 1)
    expect(svg).not.toContain("clipPath")
  })

  it("escapes the text of an initial", () => {
    expect(initialSvg({ kind: "initial", text: "<&>", color: "#10B981" }, 64)).toContain(
      ">&lt;&amp;&gt;</text>",
    )
  })
})

describe("profile renderer", () => {
  it("draws a character as a square PNG in its color and caches it", async () => {
    const draw = renderer()
    const avatar = { kind: "character", character: "capsule", color: "#6366F1" } as const
    const image = await draw.image(avatar)
    expect(image).toMatchObject({ mediaType: "image/png", size: PROFILE_AVATAR_SIZE })
    expect(image.digest).toBe(digest(image.data))
    const { data, info } = await pixelsOf(image.data)
    expect([info.width, info.height]).toEqual([PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE])
    expect([...data.subarray(0, 3)]).toEqual([0x63, 0x66, 0xf1])
    expect(await draw.image(avatar)).toBe(image)
  })

  it("draws an initial with the Host's fonts", async () => {
    const image = await renderer().image({ kind: "initial", text: "A", color: "#000000" })
    const { data, info } = await pixelsOf(image.data)
    const white = Array.from(
      { length: info.width * info.height },
      (_, index) => data[index * info.channels] ?? 0,
    ).filter((red) => red > 200).length
    expect(white).toBeGreaterThan(1000)
  })

  it("turns a WebP image avatar into a PNG of the profile size", async () => {
    const image = await renderer().image({ kind: "image", dataUrl: WEBP })
    const { data, info } = await pixelsOf(image.data)
    expect([info.width, info.height]).toEqual([PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE])
    expect(data[0]).toBeGreaterThan(240)
    expect(data[1]).toBeLessThan(16)
  })

  it("refuses an image it cannot read, and draws it again on the next try", async () => {
    const draw = renderer()
    const broken = { kind: "image", dataUrl: "data:image/png;base64,AAAA" } as const
    await expect(draw.image(broken)).rejects.toThrow()
    await expect(draw.image(broken)).rejects.toThrow()
  })

  it("gives a profile a digest of what it carries", async () => {
    const draw = renderer()
    const bot = {
      name: "Alice",
      avatar: { kind: "character", character: "ears", color: "#0EA5E9" },
    } as const
    const both = await draw.profile(bot, { name: true, avatar: true })
    const again = await draw.profile(bot, { name: true, avatar: true })
    const named = await draw.profile({ ...bot, name: "Alicia" }, { name: true, avatar: true })
    const nameOnly = await draw.profile(bot, { name: true, avatar: false })
    expect(again.digest).toBe(both.digest)
    expect(named.digest).not.toBe(both.digest)
    expect(nameOnly).toEqual({ digest: expect.any(String), name: "Alice" })
  })
})
