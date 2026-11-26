const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function encodeBase64(data: Uint8Array): string {
  let out = ""
  for (let at = 0; at < data.length; at += 3) {
    const a = data[at] as number
    const b = data[at + 1]
    const c = data[at + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += ALPHABET[(n >> 18) & 63]
    out += ALPHABET[(n >> 12) & 63]
    out += b === undefined ? "=" : ALPHABET[(n >> 6) & 63]
    out += c === undefined ? "=" : ALPHABET[n & 63]
  }
  return out
}
