import { describe, expect, it, vi } from "vitest"
import { avatarImageMessage, avatarImageNote } from "../src/client/AvatarPicker"
import {
  AVATAR_IMAGE_QUALITIES,
  AVATAR_IMAGE_SIZE,
  centerSquare,
  checkAvatarFile,
  dataUrlIs,
  type EncodeAttempt,
  encodeAttempts,
  fitEncoding,
  gifFrameCount,
  isOpaque,
  MAX_AVATAR_FILE_BYTES,
  targetSizes,
} from "../src/client/avatar-image"
import { MAX_AVATAR_DATA_URL } from "../src/shared/bots"
import { t } from "./support/client"

describe("centerSquare", () => {
  it("crops the middle of a landscape, a portrait and a square image", () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 })
    expect(centerSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 })
    expect(centerSquare(64, 64)).toEqual({ sx: 0, sy: 0, side: 64 })
  })
})

describe("targetSizes", () => {
  it("starts at 256 px and never scales a small image up", () => {
    expect(targetSizes(4000)[0]).toBe(AVATAR_IMAGE_SIZE)
    expect(targetSizes(4000)).toEqual([256, 192, 128, 96, 64])
    expect(targetSizes(150)).toEqual([128, 96, 64])
    expect(targetSizes(40)).toEqual([40])
  })
})

describe("encodeAttempts", () => {
  it("tries PNG, then WebP at falling quality, per size, largest first", () => {
    const attempts = encodeAttempts([256, 128], false)
    expect(attempts[0]).toEqual({ size: 256, type: "image/png" })
    expect(attempts.slice(1, 1 + AVATAR_IMAGE_QUALITIES.length).map((a) => a.quality)).toEqual([
      ...AVATAR_IMAGE_QUALITIES,
    ])
    expect(attempts.every((a) => a.type !== "image/jpeg")).toBe(true)
    expect(attempts.findIndex((a) => a.size === 128)).toBe(1 + AVATAR_IMAGE_QUALITIES.length)
  })

  it("adds JPEG only for an image without transparency", () => {
    const attempts = encodeAttempts([256], true)
    expect(attempts.filter((a) => a.type === "image/jpeg")).toHaveLength(
      AVATAR_IMAGE_QUALITIES.length,
    )
    expect(attempts.at(-1)?.type).toBe("image/jpeg")
  })
})

describe("fitEncoding", () => {
  const url = (type: string, length: number) => {
    const head = `data:${type};base64,`
    return head + "A".repeat(Math.max(0, length - head.length))
  }

  it("takes the first encoding that fits the limit", () => {
    const attempts = encodeAttempts([256, 128], true)
    const encode = vi.fn((attempt: EncodeAttempt) =>
      url(attempt.type, attempt.size === 256 && (attempt.quality ?? 1) > 0.7 ? 300_000 : 50_000),
    )
    const fitted = fitEncoding(attempts, encode)
    expect(fitted?.attempt).toEqual({ size: 256, type: "image/webp", quality: 0.62 })
    expect(fitted?.dataUrl.length).toBeLessThanOrEqual(MAX_AVATAR_DATA_URL)
    expect(encode).toHaveBeenCalledTimes(5)
  })

  it("skips an encoding the browser answered with PNG", () => {
    const attempts = encodeAttempts([256], true)
    const fitted = fitEncoding(attempts, (attempt) =>
      attempt.type === "image/webp"
        ? url("image/png", 100)
        : url(attempt.type, 250_000 - 1000 * (attempt.quality ?? 0) * 100),
    )
    expect(fitted?.attempt.type).toBe("image/jpeg")
  })

  it("gives up when nothing fits, so the caller reports the smallest size tried", () => {
    expect(fitEncoding(encodeAttempts([64], false), (a) => url(a.type, 300_000))).toBeUndefined()
  })

  it("tells a data URL's type", () => {
    expect(dataUrlIs("data:image/webp;base64,AA", "image/webp")).toBe(true)
    expect(dataUrlIs("data:image/png;base64,AA", "image/webp")).toBe(false)
  })
})

describe("isOpaque", () => {
  it("reads the alpha channel of RGBA pixels", () => {
    expect(isOpaque([1, 2, 3, 255, 4, 5, 6, 255])).toBe(true)
    expect(isOpaque([1, 2, 3, 255, 4, 5, 6, 254])).toBe(false)
  })
})

describe("checkAvatarFile", () => {
  it("refuses other types and huge files before decoding", () => {
    expect(checkAvatarFile({ type: "image/png", size: 1000 })).toBeUndefined()
    expect(checkAvatarFile({ type: "image/svg+xml", size: 10 })).toEqual({
      kind: "unsupported-type",
      type: "image/svg+xml",
    })
    expect(checkAvatarFile({ type: "image/jpeg", size: MAX_AVATAR_FILE_BYTES + 1 })).toEqual({
      kind: "file-too-large",
      bytes: MAX_AVATAR_FILE_BYTES + 1,
      limit: MAX_AVATAR_FILE_BYTES,
    })
  })
})

/** A minimal GIF: header, screen descriptor with a 2-color table, `frames` images, trailer. */
function gif(frames: number): Uint8Array {
  const bytes = [
    ...Array.from("GIF89a", (c) => c.charCodeAt(0)),
    1,
    0,
    1,
    0,
    0x80,
    0,
    0,
    0,
    0,
    0,
    255,
    255,
    255,
    0x21,
    0xff,
    11,
    ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)),
    3,
    1,
    0,
    0,
    0,
  ]
  for (let index = 0; index < frames; index++) {
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0)
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0)
  }
  bytes.push(0x3b)
  return new Uint8Array(bytes)
}

describe("gifFrameCount", () => {
  it("counts a still and an animated GIF", () => {
    expect(gifFrameCount(gif(1))).toBe(1)
    expect(gifFrameCount(gif(3))).toBe(2)
    expect(gifFrameCount(gif(3), 10)).toBe(3)
  })

  it("is 0 for bytes that are not a GIF", () => {
    expect(gifFrameCount(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(0)
  })
})

describe("picker messages", () => {
  it("names the reason a file cannot be used", () => {
    expect(avatarImageMessage(t, { kind: "unsupported-type", type: "image/svg+xml" })).toBe(
      "avatar.error.type(image/svg+xml)",
    )
    expect(avatarImageMessage(t, { kind: "unsupported-type", type: "" })).toBe(
      "avatar.error.typeUnknown",
    )
    expect(
      avatarImageMessage(t, { kind: "file-too-large", bytes: 31457280, limit: 20971520 }),
    ).toBe("avatar.error.fileSize(30.0 MB,20.0 MB)")
    expect(avatarImageMessage(t, { kind: "too-large", smallest: 64 })).toBe("avatar.error.fit(64)")
  })

  it("says how the image was made into an avatar, and that an animation was dropped", () => {
    const avatar = { kind: "image", dataUrl: "data:image/webp;base64,AA" } as const
    expect(avatarImageNote(t, { avatar, size: 256, animationDropped: false })).toBe(
      "avatar.note.resized(256)",
    )
    expect(avatarImageNote(t, { avatar, size: 192, animationDropped: true })).toBe(
      "avatar.note.resized(192) avatar.note.animation",
    )
  })
})
