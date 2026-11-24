import type { ConnectorPanelStream } from "@1outres/dsh-bot-core"
import { parseScreenDown, type ScreenHolder, type ScreenRequest } from "../shared/screen"
import { base64ToBytes, bytesToBase64 } from "./base64"

type ReadyState = "connecting" | "open" | "closing" | "closed"

export interface ChannelEvents {
  control(holder: ScreenHolder, request: ScreenRequest | null): void
}

/**
 * The WebSocket-shaped raw channel noVNC attaches to (send, close,
 * binaryType, on…, protocol, readyState as own properties), over the panel's
 * `screen` stream. noVNC reuses the buffer it sends, so it is encoded at once.
 */
export class ScreenChannel {
  binaryType = "arraybuffer"
  protocol = ""
  readyState: ReadyState = "connecting"
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(
    private readonly stream: ConnectorPanelStream,
    private readonly events: ChannelEvents,
  ) {
    void this.pump()
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== "open") return
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.stream.send({ type: "rfb", data: bytesToBase64(bytes) })
  }

  /** A control item (take, release, decline) while the stream is open. */
  control(type: "take" | "release" | "decline"): void {
    if (this.readyState === "open") this.stream.send({ type })
  }

  close(): void {
    if (this.readyState === "closed" || this.readyState === "closing") return
    this.readyState = "closing"
    this.stream.dispose()
  }

  private async pump(): Promise<void> {
    let reason = "the stream ended"
    let clean = true
    try {
      for await (const item of this.stream) {
        if (this.readyState === "closing") break
        if (this.readyState === "connecting") {
          this.readyState = "open"
          this.onopen?.(new Event("open"))
        }
        const down = parseScreenDown(item)
        if (down.type === "control") this.events.control(down.holder, down.request)
        else this.onmessage?.({ data: base64ToBytes(down.data).buffer })
      }
    } catch (error) {
      clean = false
      reason = error instanceof Error ? error.message : String(error)
      this.onerror?.(new Event("error"))
    } finally {
      const closing = this.readyState === "closing"
      this.readyState = "closed"
      this.onclose?.({ code: clean || closing ? 1000 : 1006, reason, wasClean: clean || closing })
    }
  }
}
