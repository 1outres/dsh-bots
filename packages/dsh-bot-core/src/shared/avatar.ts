export const BOT_CHARACTERS = [
  "capsule",
  "antenna",
  "scanner",
  "ears",
  "kitty",
  "twin",
  "monitor",
  "sleepy",
] as const

export type BotCharacter = (typeof BOT_CHARACTERS)[number]

export interface CharacterAvatar {
  readonly kind: "character"
  readonly character: BotCharacter
  readonly color: string
}

export interface InitialAvatar {
  readonly kind: "initial"
  readonly text: string
  readonly color: string
}

export interface ImageAvatar {
  readonly kind: "image"
  readonly dataUrl: string
}

export type BotAvatar = CharacterAvatar | InitialAvatar | ImageAvatar

export const MAX_AVATAR_DATA_URL = 200_000
export const MAX_AVATAR_INITIAL = 16
export const INITIAL_PLACEHOLDER = "?"

const COLOR = /^#[0-9a-fA-F]{6}$/
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,/

export function isBotCharacter(value: unknown): value is BotCharacter {
  return BOT_CHARACTERS.some((character) => character === value)
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function firstOf<T>(items: Iterable<T>): T | undefined {
  for (const item of items) return item
  return undefined
}

export function initialOf(name: string): string {
  const grapheme = firstOf(graphemes.segment(name.trim()))?.segment
  if (grapheme === undefined) return INITIAL_PLACEHOLDER
  const initial = grapheme.length > MAX_AVATAR_INITIAL ? firstOf(grapheme) : grapheme
  if (initial === undefined) return INITIAL_PLACEHOLDER
  return initial.toLocaleUpperCase()
}

function initialText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_AVATAR_INITIAL) {
    throw new Error("avatar initial is invalid")
  }
  return value
}

function color(value: unknown): string {
  if (typeof value !== "string" || !COLOR.test(value)) throw new Error("avatar color is invalid")
  return value
}

function character(value: unknown): BotCharacter {
  if (!isBotCharacter(value)) throw new Error("avatar character is unknown")
  return value
}

function imageDataUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !IMAGE_DATA_URL.test(value) ||
    value.length > MAX_AVATAR_DATA_URL
  ) {
    throw new Error("avatar image is invalid or too large")
  }
  return value
}

export function validateAvatar(avatar: unknown): BotAvatar {
  if (typeof avatar !== "object" || avatar === null) throw new Error("avatar is missing")
  const value = avatar as Record<string, unknown>
  switch (value.kind) {
    case "character":
      return { kind: "character", character: character(value.character), color: color(value.color) }
    case "initial":
      return { kind: "initial", text: initialText(value.text), color: color(value.color) }
    case "image":
      return { kind: "image", dataUrl: imageDataUrl(value.dataUrl) }
    default:
      throw new Error("avatar kind is unknown")
  }
}
