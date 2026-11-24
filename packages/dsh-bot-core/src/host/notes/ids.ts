/** A UUIDv7 (RFC 9562) from a Unix time in milliseconds and 10 random bytes: ids sort by creation time. */
export function uuidv7(ms: number, random: Uint8Array): string {
  if (random.length < 10) throw new Error("a UUIDv7 takes 10 random bytes")
  const bytes = new Uint8Array(16)
  let time = Math.floor(ms)
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  bytes[6] = 0x70 | ((random[0] as number) & 0x0f)
  bytes[7] = random[1] as number
  bytes[8] = 0x80 | ((random[2] as number) & 0x3f)
  bytes.set(random.subarray(3, 10), 9)
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
