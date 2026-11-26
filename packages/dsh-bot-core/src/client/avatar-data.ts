import {
  BOT_CHARACTERS,
  type BotAvatar,
  type BotCharacter,
  type ImageAvatar,
  initialOf,
} from "../shared/avatar"

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

export type AvatarFigure = BotCharacter | "initial"

export const AVATAR_FIGURES: readonly AvatarFigure[] = [...BOT_CHARACTERS, "initial"]

export interface AvatarChoice {
  readonly figure: AvatarFigure
  readonly color: string
  readonly image: ImageAvatar | undefined
}

export const DEFAULT_AVATAR_CHOICE: AvatarChoice = {
  figure: "capsule",
  color: AVATAR_COLORS[0],
  image: undefined,
}

export function composeAvatar(figure: AvatarFigure, color: string, name: string): BotAvatar {
  if (figure === "initial") return { kind: "initial", text: initialOf(name), color }
  return { kind: "character", character: figure, color }
}

export function decomposeAvatar(avatar: BotAvatar): AvatarChoice {
  switch (avatar.kind) {
    case "image":
      return { ...DEFAULT_AVATAR_CHOICE, image: avatar }
    case "initial":
      return { figure: "initial", color: avatar.color, image: undefined }
    case "character":
      return { figure: avatar.character, color: avatar.color, image: undefined }
  }
}

export function avatarOfChoice(choice: AvatarChoice, name: string): BotAvatar {
  return choice.image ?? composeAvatar(choice.figure, choice.color, name)
}

export function sameChoice(left: AvatarChoice, right: AvatarChoice): boolean {
  if (left.image !== undefined || right.image !== undefined) {
    return left.image?.dataUrl === right.image?.dataUrl
  }
  return left.figure === right.figure && left.color === right.color
}

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
