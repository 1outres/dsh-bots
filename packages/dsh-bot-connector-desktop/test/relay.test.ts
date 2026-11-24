import { describe, expect, it } from "vitest"
import { DesktopControl } from "../src/host/control"
import { relay } from "../src/host/screen/relay"
import type { ScreenUp } from "../src/shared/screen"

/** A queue both sides of a test stream push into and read from. */
function queue<T>() {
  const items: T[] = []
  let wake: (() => void) | undefined
  let ended = false
  return {
    push(item: T) {
      items.push(item)
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        async next(): Promise<IteratorResult<T>> {
          while (items.length === 0 && !ended)
            await new Promise<void>((resolve) => (wake = resolve))
          const item = items.shift()
          return item === undefined
            ? { done: true, value: undefined }
            : { done: false, value: item }
        },
        async return(): Promise<IteratorResult<T>> {
          ended = true
          wake?.()
          return { done: true, value: undefined }
        },
      }),
    } as AsyncIterable<T>,
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve))
}
const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64")
const HANDSHAKE = [...Buffer.from("RFB 003.008\n"), 1, 0]
const KEY_DOWN_A = [4, 1, 0, 0, 0, 0, 0, 0x61]
const KEY_UP_A = [4, 0, 0, 0, 0, 0, 0, 0x61]

function setup() {
  const control = new DesktopControl(() => 0)
  const viewer = Symbol("viewer")
  const server = queue<Uint8Array>()
  const uplink = queue<ScreenUp>()
  const written: number[] = []
  let terminated = false
  const abort = new AbortController()
  const items = relay({
    botId: "b1",
    viewer,
    control,
    pipe: {
      stdin: {
        async write(data) {
          written.push(...data)
        },
        async end() {},
      },
      stdout: server.iterable,
      terminate: () => {
        terminated = true
        server.end()
      },
    },
    uplink: uplink.iterable,
    signal: abort.signal,
  })[Symbol.asyncIterator]()
  return { control, viewer, server, uplink, written, items, abort, terminated: () => terminated }
}

describe("the screen relay", () => {
  it("tells who holds the input, relays the screen, and lets input through only from control", async () => {
    const { control, viewer, server, uplink, written, items } = setup()
    expect((await items.next()).value).toEqual({ type: "control", holder: "agent", request: null })
    server.push(Uint8Array.of(1, 2, 3))
    expect((await items.next()).value).toEqual({ type: "rfb", data: b64([1, 2, 3]) })
    const reading = items.next()
    uplink.push({ type: "rfb", data: b64([...HANDSHAKE, ...KEY_DOWN_A]) })
    await settle()
    expect(written).toEqual([...HANDSHAKE.slice(0, 13), 1])
    uplink.push({ type: "take" })
    expect((await reading).value).toMatchObject({ type: "control", holder: "self" })
    expect(control.holds("b1", viewer)).toBe(true)
    const next = items.next()
    uplink.push({ type: "rfb", data: b64(KEY_DOWN_A) })
    await settle()
    expect(written.slice(14)).toEqual(KEY_DOWN_A)
    control.take("b1", Symbol("other"))
    expect((await next).value).toMatchObject({ type: "control", holder: "other" })
    await settle()
    expect(written.slice(22)).toEqual(KEY_UP_A)
  })

  it("gives the input back and stops the pipe when the viewer leaves", async () => {
    const { control, viewer, uplink, items, abort, terminated } = setup()
    await items.next()
    const reading = items.next()
    uplink.push({ type: "take" })
    await reading
    control.request("b1", "log in")
    expect((await items.next()).value).toMatchObject({ request: { reason: "log in" } })
    const ended = items.next()
    abort.abort()
    expect(await ended).toEqual({ done: true, value: undefined })
    expect(control.holds("b1", viewer)).toBe(false)
    expect(control.view("b1").controller).toBe("agent")
    expect(terminated()).toBe(true)
  })

  it("fails the stream on RFB it does not know", async () => {
    const { uplink, items, control } = setup()
    await items.next()
    const reading = items.next()
    uplink.push({ type: "take" })
    await reading
    const failing = items.next()
    uplink.push({ type: "rfb", data: b64([...HANDSHAKE, 99]) })
    await expect(failing).rejects.toThrow(/unsupported client message/)
    expect(control.view("b1").controller).toBe("agent")
  })
})
