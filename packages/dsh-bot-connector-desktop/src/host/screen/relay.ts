/**
 * One viewer's relay of the bot's screen: the VM's Xvnc bytes down as `rfb`
 * items (read only when the Gateway asks for the next item, so SSH flow
 * control holds Xvnc back while the browser is slow), every change of who
 * holds the input as a `control` item, and the viewer's RFB messages up
 * through the filter. When the viewer loses control (it hands back, another
 * takes over, its stream ends) the keys and buttons it held are released.
 */
import type { BotEnvironmentProcess } from "@1outres/dsh-bot-core"
import type { ScreenDown, ScreenUp } from "../../shared/screen"
import type { DesktopControl, ViewerId } from "../control"
import { RfbClientFilter } from "./rfb-filter"

export interface RelayInput {
  readonly botId: string
  readonly viewer: ViewerId
  readonly control: DesktopControl
  /** A byte pipe to Xvnc's socket (`socat` in the VM). */
  readonly pipe: Pick<BotEnvironmentProcess, "stdin" | "stdout" | "terminate">
  readonly uplink: AsyncIterable<ScreenUp>
  readonly signal: AbortSignal
}

/** Wakes one waiter per arming. */
class Wake {
  private resolve: (() => void) | undefined
  private promise: Promise<void> | undefined

  wait(): Promise<void> {
    this.promise ??= new Promise<void>((resolve) => {
      this.resolve = resolve
    })
    return this.promise
  }

  fire(): void {
    const resolve = this.resolve
    this.resolve = undefined
    this.promise = undefined
    resolve?.()
  }
}

const toBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"))

export async function* relay(input: RelayInput): AsyncGenerator<ScreenDown> {
  const { botId, viewer, control, pipe, signal } = input
  const filter = new RfbClientFilter()
  const wake = new Wake()
  let failure: unknown
  let controlChanged = true
  let held = control.holds(botId, viewer)
  const fail = (error: unknown) => {
    failure ??= error
    wake.fire()
  }
  const write = (bytes: Uint8Array) =>
    bytes.byteLength === 0 ? Promise.resolve() : pipe.stdin.write(bytes)

  const unsubscribe = control.subscribe((changed) => {
    if (changed !== botId) return
    controlChanged = true
    const holds = control.holds(botId, viewer)
    if (held && !holds) write(filter.releaseHeld()).catch(fail)
    held = holds
    wake.fire()
  })
  const onAbort = () => wake.fire()
  signal.addEventListener("abort", onAbort, { once: true })

  const uplink = input.uplink[Symbol.asyncIterator]()
  const upstream = (async () => {
    for (;;) {
      const next = await uplink.next()
      if (next.done) return
      const item = next.value
      switch (item.type) {
        case "take":
          control.take(botId, viewer)
          break
        case "release":
          control.release(botId, viewer, "handed-back")
          break
        case "decline":
          control.decline(botId)
          break
        case "rfb":
          await write(filter.push(fromBase64(item.data), control.holds(botId, viewer)).forward)
          break
      }
    }
  })().catch(fail)

  const output = pipe.stdout[Symbol.asyncIterator]()
  let reading: Promise<IteratorResult<Uint8Array>> | undefined
  try {
    for (;;) {
      if (failure !== undefined) throw failure
      if (signal.aborted) return
      if (controlChanged) {
        controlChanged = false
        const request = control.view(botId).request
        yield {
          type: "control",
          holder: control.viewOf(botId, viewer),
          request: request === undefined ? null : request,
        }
        continue
      }
      reading ??= output.next()
      const next = await Promise.race([reading, wake.wait().then(() => undefined)])
      if (next === undefined) continue
      reading = undefined
      if (next.done) return
      yield { type: "rfb", data: toBase64(next.value) }
    }
  } finally {
    unsubscribe()
    signal.removeEventListener("abort", onAbort)
    control.release(botId, viewer, "viewer-left")
    await write(filter.releaseHeld()).catch(() => {})
    pipe.terminate()
    await uplink.return?.()
    await upstream
  }
}
