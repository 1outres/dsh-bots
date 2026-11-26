import { createElement, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Avatar } from "../src/client/Avatar"
import { CharacterAvatar } from "../src/client/CharacterAvatar"
import { CHARACTER_SHAPES, characterPalette } from "../src/client/character-shapes"
import { BOT_CHARACTERS } from "../src/shared/avatar"

const INK = "#1E1B2E"
const BODY = "#FFFFFF"

const render = (character: (typeof BOT_CHARACTERS)[number], color: string) =>
  renderToStaticMarkup(createElement(CharacterAvatar, { character, color, size: 40 }))

describe("character shapes", () => {
  it("define every character and paint it white, ink and the accent", () => {
    expect(Object.keys(CHARACTER_SHAPES)).toEqual([...BOT_CHARACTERS])
    expect(characterPalette("#EC4899")).toEqual({ body: BODY, ink: INK, accent: "#EC4899" })
    for (const character of BOT_CHARACTERS) {
      const paints = CHARACTER_SHAPES[character].flatMap((shape) => [
        ...(shape.fill === undefined ? [] : [shape.fill]),
        ...(shape.stroke === undefined ? [] : [shape.stroke.paint]),
      ])
      expect(new Set(paints)).toEqual(new Set(["body", "ink", "accent"]))
    }
  })
})

describe("CharacterAvatar", () => {
  it.each(BOT_CHARACTERS)("draws %s on a circle of its color", (character) => {
    const html = render(character, "#EC4899")
    expect(html).toMatch(/^<svg class="dshb-avatar" width="40" height="40" viewBox="0 0 64 64"/)
    expect(html).toContain(`data-dshb-character="${character}"`)
    expect(html).toMatch(
      /<clipPath id="([^"]+)"><circle cx="32" cy="32" r="32"><\/circle><\/clipPath><g clip-path="url\(#\1\)"><rect width="64" height="64" fill="#EC4899">/,
    )
    const drawn = html.match(/<(rect|circle|path) /g) ?? []
    expect(drawn).toHaveLength(CHARACTER_SHAPES[character].length + 2)
    expect(html).toContain(`fill="${BODY}"`)
    expect(html).toContain(INK)
    expect(html).not.toContain("accent")
    expect(html).toMatchSnapshot()
  })

  it("draws each character differently", () => {
    const shapes = BOT_CHARACTERS.map((character) =>
      render(character, "#6366F1").replace(/data-dshb-character="[^"]+"/, ""),
    )
    expect(new Set(shapes).size).toBe(BOT_CHARACTERS.length)
  })

  it("gives every avatar on a page its own clip path", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(Avatar, {
          avatar: { kind: "character", character: "ears", color: "#6366F1" },
          size: 16,
        }),
        createElement(Avatar, {
          avatar: { kind: "character", character: "ears", color: "#6366F1" },
          size: 16,
        }),
      ),
    )
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1])
    const uses = [...html.matchAll(/clip-path="url\(#([^)]+)\)"/g)].map((match) => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(uses).toEqual(ids)
  })
})

describe("Avatar", () => {
  it("draws a character, an initial and an image", () => {
    const character = renderToStaticMarkup(
      createElement(Avatar, {
        avatar: { kind: "character", character: "monitor", color: "#10B981" },
        size: 24,
      }),
    )
    expect(character).toContain('data-dshb-character="monitor"')
    const initial = renderToStaticMarkup(
      createElement(Avatar, { avatar: { kind: "initial", text: "A", color: "#10B981" }, size: 24 }),
    )
    expect(initial).toMatch(/^<span class="dshb-avatar"[^>]*>A<\/span>$/)
    const image = renderToStaticMarkup(
      createElement(Avatar, {
        avatar: { kind: "image", dataUrl: "data:image/png;base64,AA" },
        size: 24,
      }),
    )
    expect(image).toMatch(/^<img class="dshb-avatar" src="data:image\/png;base64,AA"/)
  })
})
