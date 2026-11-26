import { type ImageAvatar, MAX_AVATAR_DATA_URL } from "../shared/avatar"

export const AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
export type AvatarImageType = (typeof AVATAR_IMAGE_TYPES)[number]

export const AVATAR_IMAGE_SIZE = 256
export const AVATAR_IMAGE_SIZES = [AVATAR_IMAGE_SIZE, 192, 128, 96, 64] as const
export const AVATAR_IMAGE_QUALITIES = [0.92, 0.82, 0.72, 0.62, 0.52] as const
export const MAX_AVATAR_FILE_BYTES = 20 * 1024 * 1024

export type AvatarEncoding = "image/png" | "image/webp" | "image/jpeg"

export interface EncodeAttempt {
  readonly size: number
  readonly type: AvatarEncoding
  readonly quality?: number
}

export type AvatarImageFailure =
  | { readonly kind: "unsupported-type"; readonly type: string }
  | { readonly kind: "file-too-large"; readonly bytes: number; readonly limit: number }
  | { readonly kind: "unreadable" }
  | { readonly kind: "empty" }
  | { readonly kind: "canvas" }
  | { readonly kind: "too-large"; readonly smallest: number }

export class AvatarImageError extends Error {
  override readonly name = "AvatarImageError"
  constructor(readonly failure: AvatarImageFailure) {
    super(`avatar image: ${failure.kind}`)
  }
}

export interface AvatarImage {
  readonly avatar: ImageAvatar
  readonly size: number
  readonly animationDropped: boolean
}

export interface SquareCrop {
  readonly sx: number
  readonly sy: number
  readonly side: number
}

export function centerSquare(width: number, height: number): SquareCrop {
  const side = Math.min(width, height)
  return { sx: (width - side) / 2, sy: (height - side) / 2, side }
}

export function targetSizes(side: number): number[] {
  const sizes = AVATAR_IMAGE_SIZES.filter((size) => size <= side)
  return sizes.length > 0 ? sizes : [Math.max(1, Math.floor(side))]
}

export function encodeAttempts(sizes: readonly number[], opaque: boolean): EncodeAttempt[] {
  return sizes.flatMap((size) => [
    { size, type: "image/png" as const },
    ...AVATAR_IMAGE_QUALITIES.map((quality) => ({ size, type: "image/webp" as const, quality })),
    ...(opaque
      ? AVATAR_IMAGE_QUALITIES.map((quality) => ({ size, type: "image/jpeg" as const, quality }))
      : []),
  ])
}

export function dataUrlIs(dataUrl: string, type: AvatarEncoding): boolean {
  return dataUrl.startsWith(`data:${type};base64,`)
}

export function fitEncoding(
  attempts: readonly EncodeAttempt[],
  encode: (attempt: EncodeAttempt) => string,
  limit: number = MAX_AVATAR_DATA_URL,
): { readonly attempt: EncodeAttempt; readonly dataUrl: string } | undefined {
  for (const attempt of attempts) {
    const dataUrl = encode(attempt)
    if (dataUrlIs(dataUrl, attempt.type) && dataUrl.length <= limit) return { attempt, dataUrl }
  }
  return undefined
}

export function isOpaque(data: ArrayLike<number>): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return false
  }
  return true
}

const isAvatarImageType = (type: string): type is AvatarImageType =>
  (AVATAR_IMAGE_TYPES as readonly string[]).includes(type)

export function checkAvatarFile(file: {
  readonly type: string
  readonly size: number
}): AvatarImageFailure | undefined {
  if (!isAvatarImageType(file.type)) return { kind: "unsupported-type", type: file.type }
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    return { kind: "file-too-large", bytes: file.size, limit: MAX_AVATAR_FILE_BYTES }
  }
  return undefined
}

const skipSubBlocks = (bytes: Uint8Array, start: number): number => {
  let at = start
  while (at < bytes.length) {
    const length = bytes[at] ?? 0
    at += 1
    if (length === 0) return at
    at += length
  }
  return at
}

const colorTableBytes = (packed: number): number =>
  packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0

export function gifFrameCount(bytes: Uint8Array, stopAt = 2): number {
  const signature = String.fromCharCode(...bytes.subarray(0, 6))
  if (signature !== "GIF87a" && signature !== "GIF89a") return 0
  let at = 13 + colorTableBytes(bytes[10] ?? 0)
  let frames = 0
  while (at < bytes.length && frames < stopAt) {
    const block = bytes[at]
    if (block === 0x3b) break
    if (block === 0x21) {
      at = skipSubBlocks(bytes, at + 2)
    } else if (block === 0x2c) {
      frames += 1
      at = skipSubBlocks(bytes, at + 10 + colorTableBytes(bytes[at + 9] ?? 0) + 1)
    } else {
      break
    }
  }
  return frames
}

async function bytesOf(file: File): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new AvatarImageError({ kind: "unreadable" })
  }
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new AvatarImageError({ kind: "unreadable" }))
    element.src = url
  })
}

function squareCanvas(image: HTMLImageElement, crop: SquareCrop, size: number) {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (context === null) throw new AvatarImageError({ kind: "canvas" })
  context.imageSmoothingQuality = "high"
  context.drawImage(image, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size)
  return { canvas, context }
}

export async function imageAvatar(file: File): Promise<AvatarImage> {
  const refused = checkAvatarFile(file)
  if (refused !== undefined) throw new AvatarImageError(refused)
  const animationDropped = file.type === "image/gif" && gifFrameCount(await bytesOf(file)) > 1
  const url = URL.createObjectURL(file)
  try {
    const image = await decode(url)
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new AvatarImageError({ kind: "empty" })
    }
    const crop = centerSquare(image.naturalWidth, image.naturalHeight)
    const sizes = targetSizes(crop.side)
    const canvases = new Map<number, HTMLCanvasElement>()
    const canvasAt = (size: number) => {
      const existing = canvases.get(size)
      if (existing !== undefined) return existing
      const { canvas } = squareCanvas(image, crop, size)
      canvases.set(size, canvas)
      return canvas
    }
    const first = squareCanvas(image, crop, sizes[0] ?? AVATAR_IMAGE_SIZE)
    canvases.set(first.canvas.width, first.canvas)
    const pixels = first.context.getImageData(0, 0, first.canvas.width, first.canvas.height)
    const fitted = fitEncoding(encodeAttempts(sizes, isOpaque(pixels.data)), (attempt) =>
      canvasAt(attempt.size).toDataURL(attempt.type, attempt.quality),
    )
    if (fitted === undefined) {
      throw new AvatarImageError({ kind: "too-large", smallest: sizes[sizes.length - 1] ?? 0 })
    }
    return {
      avatar: { kind: "image", dataUrl: fitted.dataUrl },
      size: fitted.attempt.size,
      animationDropped,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
