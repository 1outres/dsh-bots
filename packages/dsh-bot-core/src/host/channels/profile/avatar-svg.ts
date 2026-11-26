import type { CharacterAvatar, InitialAvatar } from "../../../shared/avatar"
import {
  CHARACTER_SHAPES,
  CHARACTER_VIEW_SIZE,
  type CharacterPaint,
  type CharacterShape,
  characterPalette,
} from "../../../shared/character-shapes"

export const PROFILE_FONT_FAMILY = "sans-serif"

type Palette = { readonly [P in CharacterPaint]: string }

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character)
}

function attributes(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}="${escapeXml(String(value))}"`)
    .join(" ")
}

function paintOf(shape: CharacterShape, palette: Palette): Record<string, string | number> {
  return {
    fill: shape.fill === undefined ? "none" : palette[shape.fill],
    ...(shape.stroke === undefined
      ? {}
      : {
          stroke: palette[shape.stroke.paint],
          "stroke-width": shape.stroke.width,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
  }
}

function shapeSvg(shape: CharacterShape, palette: Palette): string {
  const paint = paintOf(shape, palette)
  switch (shape.kind) {
    case "rect":
      return `<rect ${attributes({ x: shape.x, y: shape.y, width: shape.width, height: shape.height, rx: shape.radius, ...paint })}/>`
    case "circle":
      return `<circle ${attributes({ cx: shape.cx, cy: shape.cy, r: shape.r, ...paint })}/>`
    case "path":
      return `<path ${attributes({ d: shape.d, ...paint })}/>`
  }
}

function frame(size: number, color: string, body: string): string {
  const view = CHARACTER_VIEW_SIZE
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${attributes({ width: size, height: size, viewBox: `0 0 ${view} ${view}` })}>`,
    `<rect ${attributes({ width: view, height: view, fill: color })}/>`,
    body,
    "</svg>",
  ].join("")
}

export function characterSvg(avatar: CharacterAvatar, size: number): string {
  const palette = characterPalette(avatar.color)
  const shapes = CHARACTER_SHAPES[avatar.character].map((shape) => shapeSvg(shape, palette))
  return frame(size, avatar.color, shapes.join(""))
}

export function initialSvg(avatar: InitialAvatar, size: number): string {
  const half = CHARACTER_VIEW_SIZE / 2
  const text = attributes({
    x: half,
    y: half,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-family": PROFILE_FONT_FAMILY,
    "font-size": half,
    "font-weight": 600,
    fill: "#FFFFFF",
  })
  return frame(size, avatar.color, `<text ${text}>${escapeXml(avatar.text)}</text>`)
}
