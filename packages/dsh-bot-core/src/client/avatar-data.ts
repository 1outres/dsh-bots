import type { BotAvatar } from "../shared/bots"

export const EMOJI_CHOICES = ["🤖", "🦊", "🐱", "🐙", "🦉", "🐧", "🌟", "🍀"] as const

/** Disc colors, chosen independently of the glyph; `color.<index>` names them. */
export const AVATAR_COLORS = [
  "#6366F1",
  "#F97316",
  "#EC4899",
  "#8B5CF6",
  "#0EA5E9",
  "#10B981",
  "#EAB308",
  "#EF4444",
] as const

/** A glyph choice: an index into {@link EMOJI_CHOICES}, or the name's initial. */
export type GlyphChoice = number | "initial"

/** Shown for the initial while the name is still empty. */
export const INITIAL_PLACEHOLDER = "?"

/** First user-perceived character of `name`, upper-cased when it has a case. */
export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return INITIAL_PLACEHOLDER
  let first: string | undefined
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)
    first = segments[Symbol.iterator]().next().value?.segment
  }
  first ??= Array.from(trimmed)[0] ?? INITIAL_PLACEHOLDER
  // A long cluster (e.g. a family emoji) would not fit the stored glyph limit.
  if (first.length > 16) first = Array.from(first)[0] ?? INITIAL_PLACEHOLDER
  return first.toLocaleUpperCase()
}

export function emojiAvatar(index: number, color?: string): BotAvatar {
  const at = ((index % EMOJI_CHOICES.length) + EMOJI_CHOICES.length) % EMOJI_CHOICES.length
  return { kind: "emoji", emoji: EMOJI_CHOICES[at], color: color ?? AVATAR_COLORS[at] }
}

/** The avatar for a glyph and a color; the initial follows `name`. */
export function composeAvatar(glyph: GlyphChoice, color: string, name: string): BotAvatar {
  if (glyph === "initial") return { kind: "initial", text: initialOf(name), color }
  return emojiAvatar(glyph, color)
}

/** The picker's starting choices for an existing avatar (or the defaults). */
export function decomposeAvatar(avatar: BotAvatar | undefined): AvatarChoice {
  if (avatar === undefined) return { glyph: 0, color: AVATAR_COLORS[0], image: undefined }
  if (avatar.kind === "image") return { glyph: 0, color: AVATAR_COLORS[0], image: avatar }
  if (avatar.kind === "initial") return { glyph: "initial", color: avatar.color, image: undefined }
  const index = EMOJI_CHOICES.indexOf(avatar.emoji as (typeof EMOJI_CHOICES)[number])
  return { glyph: Math.max(index, 0), color: avatar.color, image: undefined }
}

/** An avatar as the picker's controls hold it. */
export interface AvatarChoice {
  readonly glyph: GlyphChoice
  readonly color: string
  readonly image: BotAvatar | undefined
}

/** The avatar a choice picks: the uploaded image, else the glyph on its color. */
export function avatarOfChoice(choice: AvatarChoice, name: string): BotAvatar {
  return choice.image ?? composeAvatar(choice.glyph, choice.color, name)
}

/**
 * Whether two picker choices pick the same avatar: the same uploaded image, or
 * the same glyph and color when no image is in use.
 */
export function sameChoice(left: AvatarChoice, right: AvatarChoice): boolean {
  if (left.image !== undefined || right.image !== undefined) {
    return (
      left.image?.kind === "image" &&
      right.image?.kind === "image" &&
      left.image.dataUrl === right.image.dataUrl
    )
  }
  return left.glyph === right.glyph && left.color === right.color
}

/** Next index for a roving radio group key press, or undefined when the key does not move. */
export function radioStep(key: string, index: number, count: number): number | undefined {
  if (count <= 0) return undefined
  if (key === "Home") return 0
  if (key === "End") return count - 1
  const step =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0
  if (step === 0) return undefined
  return (index + step + count) % count
}
