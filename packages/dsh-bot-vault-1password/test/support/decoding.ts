import { vi } from "vitest"

/** Every text the process decodes from bytes while `work` runs. */
export async function decodedDuring(work: () => unknown): Promise<string[]> {
  const decoded: string[] = []
  const decode = TextDecoder.prototype.decode
  const bufferText = Buffer.prototype.toString
  const fromCharCode = String.fromCharCode
  const spies = [
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (
      this: TextDecoder,
      ...args
    ) {
      const text = decode.apply(this, args)
      decoded.push(text)
      return text
    }),
    vi.spyOn(Buffer.prototype, "toString").mockImplementation(function (this: Buffer, ...args) {
      const text = bufferText.apply(this, args as Parameters<Buffer["toString"]>)
      decoded.push(text)
      return text
    }),
    vi.spyOn(String, "fromCharCode").mockImplementation((...codes) => {
      const text = fromCharCode(...codes)
      decoded.push(text)
      return text
    }),
  ]
  try {
    await work()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return decoded
}

export const containing = (texts: readonly string[], secrets: readonly string[]) =>
  texts.filter((text) => secrets.some((secret) => text.includes(secret)))
