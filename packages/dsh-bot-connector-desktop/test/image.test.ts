import { describe, expect, it } from "vitest"
import { checkScreenshot } from "../src/host/image"
import { png } from "./png"

function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ])
}

const LIMITS = { maxBytes: 1 << 20, maxSide: 4096 }
const shot = (format: "png" | "jpeg", data: Buffer, width: number, height: number) => ({
  format,
  width,
  height,
  bytes: data.byteLength,
  data: data.toString("base64"),
})

describe("screenshots from the agent", () => {
  it("accept a PNG and a JPEG of the size they claim", () => {
    const image = checkScreenshot(shot("png", png(32, 20), 32, 20), LIMITS)
    expect(image).toMatchObject({ mediaType: "image/png", width: 32, height: 20 })
    expect(checkScreenshot(shot("jpeg", jpeg(640, 480), 640, 480), LIMITS).mediaType).toBe(
      "image/jpeg",
    )
  })

  it("refuse a size, a format or a length that is not what was claimed", () => {
    expect(() => checkScreenshot(shot("png", png(32, 20), 33, 20), LIMITS)).toThrow(/not the size/)
    expect(() => checkScreenshot(shot("jpeg", png(32, 20), 32, 20), LIMITS)).toThrow(/not a JPEG/)
    expect(() =>
      checkScreenshot({ ...shot("png", png(32, 20), 32, 20), bytes: 10 }, LIMITS),
    ).toThrow(/as long/)
    expect(() =>
      checkScreenshot({ ...shot("png", png(32, 20), 32, 20), data: "%%%%" }, LIMITS),
    ).toThrow(/base64/)
  })

  it("refuse images beyond the limits", () => {
    expect(() =>
      checkScreenshot(shot("png", png(32, 20), 32, 20), { maxBytes: 10, maxSide: 4096 }),
    ).toThrow(/larger than/)
    expect(() => checkScreenshot(shot("jpeg", jpeg(5000, 10), 5000, 10), LIMITS)).toThrow(/pixels/)
  })
})
