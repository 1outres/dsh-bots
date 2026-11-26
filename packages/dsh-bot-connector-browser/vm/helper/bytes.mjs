const BASE64 = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
)
const HEX = new TextEncoder().encode("0123456789abcdef")
const SHORT = new Map([
  [8, 0x62],
  [9, 0x74],
  [10, 0x6e],
  [12, 0x66],
  [13, 0x72],
  [34, 0x22],
  [92, 0x5c],
])

export function base64Bytes(bytes) {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let at = 0
  for (let i = 0; i < bytes.length; i += 3) {
    const rest = bytes.length - i
    const n =
      (bytes[i] << 16) | ((rest > 1 ? bytes[i + 1] : 0) << 8) | (rest > 2 ? bytes[i + 2] : 0)
    out[at++] = BASE64[(n >> 18) & 63]
    out[at++] = BASE64[(n >> 12) & 63]
    out[at++] = rest > 1 ? BASE64[(n >> 6) & 63] : 0x3d
    out[at++] = rest > 2 ? BASE64[n & 63] : 0x3d
  }
  return out
}

export function jsonStringBytes(bytes) {
  let length = 0
  for (const byte of bytes) length += SHORT.has(byte) ? 2 : byte < 0x20 ? 6 : 1
  const out = new Uint8Array(length)
  let at = 0
  for (const byte of bytes) {
    const short = SHORT.get(byte)
    if (short !== undefined) {
      out[at++] = 0x5c
      out[at++] = short
    } else if (byte < 0x20) {
      out.set([0x5c, 0x75, 0x30, 0x30, HEX[byte >> 4], HEX[byte & 15]], at)
      at += 6
    } else {
      out[at++] = byte
    }
  }
  return out
}

export function isUtf8(bytes) {
  let i = 0
  while (i < bytes.length) {
    const byte = bytes[i]
    const size =
      byte < 0x80
        ? 1
        : byte >= 0xc2 && byte < 0xe0
          ? 2
          : byte >= 0xe0 && byte < 0xf0
            ? 3
            : byte >= 0xf0 && byte < 0xf5
              ? 4
              : 0
    if (size === 0 || i + size > bytes.length) return false
    for (let k = 1; k < size; k++) if ((bytes[i + k] & 0xc0) !== 0x80) return false
    i += size
  }
  return true
}
