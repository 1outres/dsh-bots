const MAX_LINE_BYTES = 64 * 1024
const MAX_SECRET_BYTES = 64 * 1024

export class ChannelError extends Error {
  constructor(message) {
    super(message)
    this.name = "ChannelError"
  }
}

export function openChannel(input = process.stdin, output = process.stdout) {
  let pending = new Uint8Array(0)
  let ended = false
  let wake
  let endedResolve
  const endedPromise = new Promise((resolve) => {
    endedResolve = resolve
  })

  input.on("data", (chunk) => {
    const joined = new Uint8Array(pending.length + chunk.length)
    joined.set(pending)
    joined.set(chunk, pending.length)
    pending.fill(0)
    chunk.fill(0)
    pending = joined
    wake?.()
  })
  input.on("end", () => {
    ended = true
    endedResolve()
    wake?.()
  })
  input.on("error", () => {
    ended = true
    endedResolve()
    wake?.()
  })

  const more = () =>
    new Promise((resolve) => {
      wake = () => {
        wake = undefined
        resolve()
      }
    })

  const take = (length) => {
    const head = pending.slice(0, length)
    const rest = pending.slice(length)
    pending.fill(0)
    pending = rest
    return head
  }

  return {
    ended: endedPromise,
    async line() {
      for (;;) {
        const index = pending.indexOf(0x0a)
        if (index >= 0) {
          const line = take(index + 1)
          let value
          try {
            value = JSON.parse(new TextDecoder().decode(line.subarray(0, index)))
          } catch {
            throw new ChannelError("a line that is not JSON")
          }
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new ChannelError("a line that is not an object")
          }
          return value
        }
        if (pending.length > MAX_LINE_BYTES) throw new ChannelError("a line too long")
        if (ended) return undefined
        await more()
      }
    },
    async bytes(length) {
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SECRET_BYTES) {
        throw new ChannelError("a secret of an unexpected length")
      }
      while (pending.length < length) {
        if (ended) throw new ChannelError("the input ended early")
        await more()
      }
      return take(length)
    },
    reply(message) {
      output.write(`${JSON.stringify(message)}\n`)
    },
  }
}
