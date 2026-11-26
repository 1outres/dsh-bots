import type { BotCharacter } from "./avatar"

export type CharacterPaint = "body" | "ink" | "accent"

export interface CharacterStroke {
  readonly paint: CharacterPaint
  readonly width: number
}

export type CharacterPainting =
  | { readonly fill: CharacterPaint; readonly stroke?: CharacterStroke }
  | { readonly fill?: undefined; readonly stroke: CharacterStroke }

export type CharacterGeometry =
  | {
      readonly kind: "rect"
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly radius: number
    }
  | { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "path"; readonly d: string }

export type CharacterShape = CharacterGeometry & CharacterPainting

export const CHARACTER_VIEW_SIZE = 64

export function characterPalette(accent: string): { readonly [P in CharacterPaint]: string } {
  return { body: "#FFFFFF", ink: "#1E1B2E", accent }
}

const LINE_WIDTH = 2.6

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: CharacterPaint,
): CharacterShape => ({ kind: "rect", x, y, width, height, radius, fill })

const circle = (cx: number, cy: number, r: number, fill: CharacterPaint): CharacterShape => ({
  kind: "circle",
  cx,
  cy,
  r,
  fill,
})

const area = (d: string, fill: CharacterPaint): CharacterShape => ({ kind: "path", d, fill })

const line = (d: string, paint: CharacterPaint, width = LINE_WIDTH): CharacterShape => ({
  kind: "path",
  d,
  stroke: { paint, width },
})

const outlined = (d: string, paint: CharacterPaint, width: number): CharacterShape => ({
  kind: "path",
  d,
  fill: paint,
  stroke: { paint, width },
})

const visor = (y: number, width = 30, height = 16): CharacterShape =>
  rect(32 - width / 2, y, width, height, height / 2, "ink")

const smile = (y: number): CharacterShape => line(`M29 ${y}q3 2 6 0`, "ink")

export const CHARACTER_SHAPES: { readonly [C in BotCharacter]: readonly CharacterShape[] } = {
  capsule: [
    rect(13, 14, 38, 62, 19, "body"),
    visor(27),
    rect(23.5, 31, 4.4, 8, 2.2, "accent"),
    rect(36.1, 31, 4.4, 8, 2.2, "accent"),
    smile(49.5),
  ],
  antenna: [
    line("M32 20V12", "body", 3),
    circle(32, 10, 3.6, "body"),
    rect(11, 20, 42, 52, 12, "body"),
    visor(29, 32),
    line("M22.5 38.5q3-4 6 0", "accent"),
    line("M35.5 38.5q3-4 6 0", "accent"),
    area("M28.5 49h7q0 4.6-3.5 4.6T28.5 49Z", "ink"),
  ],
  scanner: [
    area("M7 66C7 42 17 21 32 21S57 42 57 66Z", "body"),
    visor(31, 34),
    rect(21, 36.8, 22, 4.4, 2.2, "accent"),
    line("M29 51h6", "ink"),
  ],
  ears: [
    rect(7, 32, 7, 14, 3.5, "body"),
    rect(50, 32, 7, 14, 3.5, "body"),
    circle(32, 40, 20, "body"),
    visor(31, 30),
    circle(25.5, 39, 3.2, "accent"),
    circle(38.5, 39, 3.2, "accent"),
    smile(51),
  ],
  kitty: [
    outlined("M13 27L14.5 9.5L26 18.5ZM51 27L49.5 9.5L38 18.5Z", "body", 5),
    rect(11, 22, 42, 52, 19, "body"),
    visor(31, 32),
    line("M22.5 37l3 3l3-3", "accent"),
    line("M35.5 37l3 3l3-3", "accent"),
    line("M28.5 50.5q1.75 2.2 3.5 0q1.75 2.2 3.5 0", "ink"),
  ],
  twin: [
    line("M22 21L18 12M42 21L46 12", "body", 3),
    circle(17.5, 11, 3, "body"),
    circle(46.5, 11, 3, "body"),
    area("M10 64V34Q10 20 24 20H40Q54 20 54 34V64Z", "body"),
    visor(29, 32),
    rect(23.5, 33, 4.4, 8, 2.2, "accent"),
    line("M35 37.5h6", "accent"),
    smile(50),
  ],
  monitor: [
    rect(9, 15, 46, 38, 12, "body"),
    rect(22, 55, 20, 12, 5, "body"),
    rect(14, 20, 36, 28, 9, "ink"),
    circle(25, 31, 3, "accent"),
    circle(39, 31, 3, "accent"),
    line("M27.5 38.5q4.5 4 9 0", "accent"),
  ],
  sleepy: [
    outlined("M21.5 22H42.5L54 42L42.5 62H21.5L10 42Z", "body", 6),
    line("M45 9h5l-5 6h5", "body", 2.4),
    visor(32, 32),
    line("M22.5 39q3 2.6 6 0", "accent"),
    line("M35.5 39q3 2.6 6 0", "accent"),
    { kind: "circle", cx: 32, cy: 52, r: 2, stroke: { paint: "ink", width: LINE_WIDTH } },
  ],
}
