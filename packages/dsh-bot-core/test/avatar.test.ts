import { describe, expect, it } from "vitest"
import {
  AVATAR_COLORS,
  AVATAR_FIGURES,
  composeAvatar,
  DEFAULT_AVATAR_CHOICE,
  decomposeAvatar,
  radioStep,
  sameChoice,
} from "../src/client/avatar-data"
import { en, ja } from "../src/client/i18n"
import { botRecordSchema } from "../src/host/domain"
import { BOT_CHARACTERS, initialOf, isBotCharacter, validateAvatar } from "../src/shared/avatar"

describe("validateAvatar", () => {
  it("keeps character and image avatars valid", () => {
    for (const character of BOT_CHARACTERS) {
      expect(validateAvatar({ kind: "character", character, color: "#F97316" })).toEqual({
        kind: "character",
        character,
        color: "#F97316",
      })
    }
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
    expect(() =>
      validateAvatar({ kind: "character", character: "capsule", color: "#fff" }),
    ).toThrow("color")
  })

  it("rejects an unknown character and the retired emoji kind", () => {
    expect(() => validateAvatar({ kind: "character", character: "fox", color: "#6366F1" })).toThrow(
      "avatar character is unknown",
    )
    expect(() => validateAvatar({ kind: "emoji", emoji: "🤖", color: "#6366F1" })).toThrow(
      "avatar kind is unknown",
    )
  })
})

describe("isBotCharacter", () => {
  it("knows exactly the eight characters", () => {
    expect(BOT_CHARACTERS).toEqual([
      "capsule",
      "antenna",
      "scanner",
      "ears",
      "kitty",
      "twin",
      "monitor",
      "sleepy",
    ])
    expect(BOT_CHARACTERS.every(isBotCharacter)).toBe(true)
    expect(isBotCharacter("robot")).toBe(false)
    expect(isBotCharacter(0)).toBe(false)
  })
})

describe("botRecordSchema", () => {
  const base = { name: "n", path: "/p", workspaceId: "w", createdAt: 1, updatedAt: 1 }
  it("parses the current avatar kinds and the legacy emoji kind it migrates", () => {
    for (const avatar of [
      { kind: "character", character: "kitty", color: "#6366F1" },
      { kind: "emoji", emoji: "🤖", color: "#6366F1" },
      { kind: "image", dataUrl: "data:image/png;base64,AAAA" },
      { kind: "initial", text: "あ", color: "#EF4444" },
    ]) {
      expect(botRecordSchema.safeParse({ ...base, avatar }).success).toBe(true)
    }
  })
  it("refuses a character it does not know", () => {
    const avatar = { kind: "character", character: "fox", color: "#6366F1" }
    expect(botRecordSchema.safeParse({ ...base, avatar }).success).toBe(false)
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
  it("combines figure and color independently", () => {
    expect(composeAvatar("antenna", AVATAR_COLORS[4], "x")).toEqual({
      kind: "character",
      character: "antenna",
      color: AVATAR_COLORS[4],
    })
    expect(composeAvatar("initial", AVATAR_COLORS[2], "bob")).toEqual({
      kind: "initial",
      text: "B",
      color: AVATAR_COLORS[2],
    })
  })
  it("offers the eight characters, then the initial", () => {
    expect(AVATAR_FIGURES).toEqual([...BOT_CHARACTERS, "initial"])
  })
  it("starts from the first character in the first color", () => {
    expect(DEFAULT_AVATAR_CHOICE).toEqual({
      figure: "capsule",
      color: AVATAR_COLORS[0],
      image: undefined,
    })
  })
  it("round-trips the dialog choices", () => {
    expect(decomposeAvatar({ kind: "character", character: "kitty", color: "#22C55E" })).toEqual({
      figure: "kitty",
      color: "#22C55E",
      image: undefined,
    })
    expect(decomposeAvatar({ kind: "initial", text: "Z", color: "#EF4444" })).toEqual({
      figure: "initial",
      color: "#EF4444",
      image: undefined,
    })
    const image = { kind: "image", dataUrl: "data:image/png;base64,AAAA" } as const
    expect(decomposeAvatar(image)).toEqual({ ...DEFAULT_AVATAR_CHOICE, image })
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
  it("compares figure and color while no image is in use", () => {
    expect(
      sameChoice(
        { figure: "antenna", color: blue, image: undefined },
        { figure: "antenna", color: blue, image: undefined },
      ),
    ).toBe(true)
    expect(
      sameChoice(
        { figure: "antenna", color: blue, image: undefined },
        { figure: "scanner", color: blue, image: undefined },
      ),
    ).toBe(false)
    expect(
      sameChoice(
        { figure: "initial", color: blue, image: undefined },
        { figure: "initial", color: red, image: undefined },
      ),
    ).toBe(false)
  })
  it("compares images by data and ignores the hidden figure behind them", () => {
    const a = image("data:image/png;base64,AA")
    expect(
      sameChoice(
        { figure: "capsule", color: blue, image: a },
        { figure: "ears", color: red, image: image(a.dataUrl) },
      ),
    ).toBe(true)
    expect(
      sameChoice(
        { figure: "capsule", color: blue, image: a },
        { figure: "capsule", color: blue, image: image("data:image/png;base64,BB") },
      ),
    ).toBe(false)
    expect(
      sameChoice(
        { figure: "capsule", color: blue, image: a },
        { figure: "capsule", color: blue, image: undefined },
      ),
    ).toBe(false)
  })
})

describe("i18n", () => {
  it("translates the same keys in en and ja", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
    for (const index of AVATAR_COLORS.keys()) expect(en[`color.${index}`]).toBeDefined()
    for (const character of BOT_CHARACTERS) {
      expect(en[`avatar.character.${character}`]).toBeDefined()
    }
  })
})
