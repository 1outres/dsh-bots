import type { ConnectorPanelStream } from "@1outres/dsh-bot-core"
import RFB from "@novnc/novnc"
import type { ScreenHolder, ScreenRequest } from "../shared/screen"
import { ScreenChannel } from "./channel"

/**
 * - `connecting`: the stream is opening;
 * - `connected`: the screen shows;
 * - `paused`: the page is hidden and this viewer does not hold the input, so no picture is fetched;
 * - `disconnected`: the stream ended; it is opened again at `retryAt` (or now, on request).
 */
export type ScreenStatus = "connecting" | "connected" | "paused" | "disconnected"

export interface ScreenState {
  readonly status: ScreenStatus
  readonly holder: ScreenHolder
  readonly request: ScreenRequest | null
  /** While disconnected: when the stream opens again. */
  readonly retryAt?: number
}

export interface ScreenTimers {
  now(): number
  later(ms: number, work: () => void): () => void
}

export interface ScreenSessionDeps {
  open(): ConnectorPanelStream
  readonly target: HTMLElement
  /** The page's visibility. */
  readonly page: {
    hidden(): boolean
    onChange(listener: () => void): () => void
  }
  readonly timers: ScreenTimers
}

const FIRST_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const INITIAL: ScreenState = { status: "connecting", holder: "agent", request: null }

/** One viewer of a bot's desktop: noVNC on the panel's `screen` stream, and the state the panel draws. */
export class ScreenSession {
  private state: ScreenState = INITIAL
  private readonly listeners = new Set<() => void>()
  private channel: ScreenChannel | undefined
  private rfb: RFB | undefined
  private cancelRetry: (() => void) | undefined
  private retryMs = FIRST_RETRY_MS
  private readonly offPage: () => void
  private disposed = false

  constructor(private readonly deps: ScreenSessionDeps) {
    this.offPage = deps.page.onChange(() => this.visibility())
    if (deps.page.hidden()) this.set({ ...INITIAL, status: "paused" })
    else this.connect()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): ScreenState => this.state

  /** Open the stream now (again). */
  connect(): void {
    if (this.disposed) return
    this.teardown()
    this.set({ ...INITIAL, request: this.state.request })
    const channel = new ScreenChannel(this.deps.open(), {
      control: (holder, request) => {
        if (this.channel !== channel) return
        if (this.rfb !== undefined) this.rfb.viewOnly = holder !== "self"
        this.set({ holder, request })
        if (holder === "self") this.rfb?.focus()
      },
    })
    const rfb = new RFB(this.deps.target, channel, { shared: true })
    rfb.viewOnly = true
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.focusOnClick = true
    rfb.background = "transparent"
    rfb.qualityLevel = 6
    rfb.compressionLevel = 2
    rfb.addEventListener("connect", () => {
      if (this.rfb !== rfb) return
      this.retryMs = FIRST_RETRY_MS
      this.set({ status: "connected" })
    })
    rfb.addEventListener("disconnect", () => {
      if (this.rfb !== rfb) return
      this.rfb = undefined
      this.channel = undefined
      this.deps.target.replaceChildren()
      this.lost()
    })
    this.channel = channel
    this.rfb = rfb
  }

  take(): void {
    this.channel?.control("take")
  }

  release(): void {
    this.channel?.control("release")
  }

  decline(): void {
    this.channel?.control("decline")
  }

  /** Send Ctrl+Alt+Del (only from the viewer in control; the Host drops it otherwise). */
  ctrlAltDel(): void {
    this.rfb?.sendCtrlAltDel()
  }

  dispose(): void {
    this.disposed = true
    this.offPage()
    this.teardown()
    this.listeners.clear()
  }

  private lost(): void {
    const delay = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
    this.set({
      status: "disconnected",
      holder: "agent",
      retryAt: this.deps.timers.now() + delay,
    })
    this.cancelRetry = this.deps.timers.later(delay, () => {
      this.cancelRetry = undefined
      if (this.deps.page.hidden()) this.set({ ...INITIAL, status: "paused" })
      else this.connect()
    })
  }

  private visibility(): void {
    if (this.disposed) return
    if (this.deps.page.hidden()) {
      if (this.state.holder === "self" || this.state.status === "paused") return
      this.teardown()
      this.set({ status: "paused", holder: "agent" })
    } else if (this.state.status === "paused") {
      this.connect()
    }
  }

  private teardown(): void {
    this.cancelRetry?.()
    this.cancelRetry = undefined
    const rfb = this.rfb
    this.rfb = undefined
    this.channel = undefined
    rfb?.disconnect()
    this.deps.target.replaceChildren()
  }

  private set(patch: Partial<ScreenState>): void {
    const next: ScreenState = { ...this.state, ...patch }
    const { retryAt: _retryAt, ...rest } = next
    this.state = next.status === "disconnected" ? next : rest
    for (const listener of [...this.listeners]) listener()
  }
}
