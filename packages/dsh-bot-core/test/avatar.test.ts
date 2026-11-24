import { describe, expect, it } from "vitest"
import {
  AVATAR_COLORS,
  composeAvatar,
  decomposeAvatar,
  EMOJI_CHOICES,
  initialOf,
  radioStep,
  sameChoice,
} from "../src/client/avatar-data"
import { en, ja } from "../src/client/i18n"
import { botRecordSchema } from "../src/host/domain"
import { validateAvatar } from "../src/shared/bots"

describe("validateAvatar", () => {
  it("keeps stored emoji and image avatars valid", () => {
    expect(validateAvatar({ kind: "emoji", emoji: "🦊", color: "#F97316" })).toEqual({
      kind: "emoji",
      emoji: "🦊",
      color: "#F97316",
    })
    const dataUrl = "data:image/png;base64,AAAA"
    expect(validateAvatar({ kind: "image", dataUrl })).toEqual({ kind: "image", dataUrl })
  })

  it("accepts an initial with a color and drops extra fields", () => {
    expect(validateAvatar({ kind: "initial", text: "A", color: "#6366F1", x: 1 })).toEqual({
      kind: "initial",
      text: "A",
      color: "#6366F1",
    })
  })

  it("rejects bad initials and colors", () => {
    expect(() => validateAvatar({ kind: "initial", text: "", color: "#6366F1" })).toThrow()
    expect(() => validateAvatar({ kind: "initial", text: " ", color: "#6366F1" })).toThrow()
    expect(() =>
      validateAvatar({ kind: "initial", text: "x".repeat(17), color: "#6366F1" }),
    ).toThrow()
    expect(() => validateAvatar({ kind: "initial", text: "A", color: "red" })).toThrow("color")
    expect(() => validateAvatar({ kind: "emoji", emoji: "🦊", color: "#fff" })).toThrow("color")
  })
})

describe("botRecordSchema", () => {
  const base = { name: "n", path: "/p", workspaceId: "w", createdAt: 1, updatedAt: 1 }
  it("parses old and new avatar kinds", () => {
    for (const avatar of [
      { kind: "emoji", emoji: "🤖", color: "#6366F1" },
      { kind: "image", dataUrl: "data:image/png;base64,AAAA" },
      { kind: "initial", text: "あ", color: "#EF4444" },
    ]) {
      expect(botRecordSchema.safeParse({ ...base, avatar }).success).toBe(true)
    }
  })
})

describe("initialOf", () => {
  it("takes the first grapheme, upper-cased", () => {
    expect(initialOf("  alice")).toBe("A")
    expect(initialOf("ふくろう")).toBe("ふ")
    expect(initialOf("👨‍👩‍👧 family")).toBe("👨‍👩‍👧")
    expect(initialOf("é")).toBe("É")
  })
  it("falls back to a placeholder for an empty name", () => {
    expect(initialOf("   ")).toBe("?")
  })
})

describe("compose / decompose", () => {
  it("combines glyph and color independently", () => {
    expect(composeAvatar(1, AVATAR_COLORS[4], "x")).toEqual({
      kind: "emoji",
      emoji: EMOJI_CHOICES[1],
      color: AVATAR_COLORS[4],
    })
    expect(composeAvatar("initial", AVATAR_COLORS[2], "bob")).toEqual({
      kind: "initial",
      text: "B",
      color: AVATAR_COLORS[2],
    })
  })
  it("round-trips the dialog choices", () => {
    expect(decomposeAvatar(undefined)).toEqual({
      glyph: 0,
      color: AVATAR_COLORS[0],
      image: undefined,
    })
    expect(decomposeAvatar({ kind: "emoji", emoji: "🦉", color: "#22C55E" })).toEqual({
      glyph: 4,
      color: "#22C55E",
      image: undefined,
    })
    expect(decomposeAvatar({ kind: "initial", text: "Z", color: "#EF4444" }).glyph).toBe("initial")
    const image = { kind: "image", dataUrl: "data:image/png;base64,AAAA" } as const
    expect(decomposeAvatar(image).image).toBe(image)
  })
})

describe("radioStep", () => {
  it("moves with arrows, wraps, and jumps with Home/End", () => {
    expect(radioStep("ArrowRight", 0, 9)).toBe(1)
    expect(radioStep("ArrowDown", 8, 9)).toBe(0)
    expect(radioStep("ArrowLeft", 0, 9)).toBe(8)
    expect(radioStep("ArrowUp", 3, 9)).toBe(2)
    expect(radioStep("Home", 5, 9)).toBe(0)
    expect(radioStep("End", 1, 9)).toBe(8)
    expect(radioStep("a", 1, 9)).toBeUndefined()
  })
})

describe("sameChoice", () => {
  const blue = AVATAR_COLORS[0]
  const red = AVATAR_COLORS[1]
  const image = (dataUrl: string) => ({ kind: "image", dataUrl }) as const
  it("compares glyph and color while no image is in use", () => {
    expect(
      sameChoice(
        { glyph: 1, color: blue, image: undefined },
        { glyph: 1, color: blue, image: undefined },
      ),
    ).toBe(true)
    expect(
      sameChoice(
        { glyph: 1, color: blue, image: undefined },
        { glyph: 2, color: blue, image: undefined },
      ),
    ).toBe(false)
    expect(
      sameChoice(
        { glyph: "initial", color: blue, image: undefined },
        { glyph: "initial", color: red, image: undefined },
      ),
    ).toBe(false)
  })
  it("compares images by data and ignores the hidden glyph behind them", () => {
    const a = image("data:image/png;base64,AA")
    expect(
      sameChoice(
        { glyph: 0, color: blue, image: a },
        { glyph: 3, color: red, image: image(a.dataUrl) },
      ),
    ).toBe(true)
    expect(
      sameChoice(
        { glyph: 0, color: blue, image: a },
        { glyph: 0, color: blue, image: image("data:image/png;base64,BB") },
      ),
    ).toBe(false)
    expect(
      sameChoice({ glyph: 0, color: blue, image: a }, { glyph: 0, color: blue, image: undefined }),
    ).toBe(false)
  })
})

describe("i18n", () => {
  it("translates the same keys in en and ja", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
    for (const index of AVATAR_COLORS.keys()) expect(en[`color.${index}`]).toBeDefined()
    for (const index of EMOJI_CHOICES.keys()) expect(en[`avatar.${index}`]).toBeDefined()
  })
})
