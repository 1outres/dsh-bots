/**
 * Screenshots from the agent are untrusted: the bytes must be the format it
 * claims, of the size it claims, within limits, before they are admitted.
 */
export type ScreenshotFormat = "png" | "jpeg"

export interface ImageLimits {
  readonly maxBytes: number
  readonly maxSide: number
}

export interface CheckedImage {
  readonly mediaType: "image/png" | "image/jpeg"
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function decodeBase64(data: string): Uint8Array {
  if (data.length % 4 !== 0 || !BASE64.test(data)) throw new Error("the image is not base64")
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 33 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("the image is not a PNG")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR")
    throw new Error("the PNG has no header")
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("the image is not a JPEG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new Error("the JPEG is malformed")
    const marker = bytes[offset + 1] ?? 0
    const length = view.getUint16(offset + 2)
    if (SOF_MARKERS.has(marker)) {
      if (offset + 9 > bytes.byteLength) break
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    offset += 2 + length
  }
  throw new Error("the JPEG has no frame header")
}

/** @throws naming what is wrong with the image. */
export function checkScreenshot(
  shot: {
    readonly format: ScreenshotFormat
    readonly width: number
    readonly height: number
    readonly bytes: number
    readonly data: string
  },
  limits: ImageLimits,
): CheckedImage {
  if (shot.bytes > limits.maxBytes)
    throw new Error(`the image is larger than ${limits.maxBytes} bytes`)
  const data = decodeBase64(shot.data)
  if (data.byteLength !== shot.bytes) throw new Error("the image is not as long as the agent said")
  if (data.byteLength > limits.maxBytes)
    throw new Error(`the image is larger than ${limits.maxBytes} bytes`)
  const size = shot.format === "png" ? pngSize(data) : jpegSize(data)
  if (size.width !== shot.width || size.height !== shot.height) {
    throw new Error("the image is not the size the agent said")
  }
  if (
    size.width < 1 ||
    size.height < 1 ||
    size.width > limits.maxSide ||
    size.height > limits.maxSide
  ) {
    throw new Error(`the image is not between 1 and ${limits.maxSide} pixels on each side`)
  }
  return {
    mediaType: shot.format === "png" ? "image/png" : "image/jpeg",
    data,
    width: size.width,
    height: size.height,
  }
}
