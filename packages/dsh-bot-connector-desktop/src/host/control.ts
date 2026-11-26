import type { ConnectorRequest, ConnectorStatus } from "@1outres/dsh-bot-core"

export type DesktopController = "agent" | "human"

export type DesktopNotice = "control-returned" | "reconnected"

export type ViewerId = symbol

export type ViewerControl = "agent" | "self" | "other"

export type ControlReturn = "handed-back" | "viewer-left"

export interface DesktopControlView {
  readonly controller: DesktopController
  readonly since: number
  readonly request?: ConnectorRequest
}

export type ControlChange =
  | { readonly kind: "taken" }
  | { readonly kind: "returned"; readonly how: ControlReturn }
  | { readonly kind: "requested"; readonly request: ConnectorRequest }
  | { readonly kind: "declined"; readonly requestId: string }
  | { readonly kind: "request-ended"; readonly requestId: string }

type Listener = (botId: string, change: ControlChange) => void

interface BotDesktop {
  holder: ViewerId | undefined
  since: number
  notices: Set<DesktopNotice>
  connections: number
  request: ConnectorRequest | undefined
}

const OPERATING: ConnectorStatus["note"] = {
  en: "A person is operating this desktop",
  ja: "人がこのデスクトップを操作しています",
}

export class DesktopControl {
  private readonly bots = new Map<string, BotDesktop>()
  private readonly listeners = new Set<Listener>()
  private requests = 0

  constructor(private readonly now: () => number) {}

  private entry(botId: string): BotDesktop {
    let entry = this.bots.get(botId)
    if (entry === undefined) {
      entry = {
        holder: undefined,
        since: this.now(),
        notices: new Set(),
        connections: 0,
        request: undefined,
      }
      this.bots.set(botId, entry)
    }
    return entry
  }

  private publish(botId: string, change: ControlChange): void {
    for (const listener of [...this.listeners]) listener(botId, change)
  }

  view(botId: string): DesktopControlView {
    const entry = this.entry(botId)
    return {
      controller: entry.holder === undefined ? "agent" : "human",
      since: entry.since,
      ...(entry.request === undefined ? {} : { request: entry.request }),
    }
  }

  viewOf(botId: string, viewer: ViewerId): ViewerControl {
    const holder = this.entry(botId).holder
    if (holder === undefined) return "agent"
    return holder === viewer ? "self" : "other"
  }

  holds(botId: string, viewer: ViewerId): boolean {
    return this.entry(botId).holder === viewer
  }

  take(botId: string, viewer: ViewerId): void {
    const entry = this.entry(botId)
    if (entry.holder === viewer) return
    const fromAgent = entry.holder === undefined
    entry.holder = viewer
    if (fromAgent) entry.since = this.now()
    this.publish(botId, { kind: "taken" })
  }

  release(botId: string, viewer: ViewerId, how: ControlReturn): void {
    const entry = this.entry(botId)
    if (entry.holder !== viewer) return
    entry.holder = undefined
    entry.since = this.now()
    entry.notices.add("control-returned")
    this.publish(botId, { kind: "returned", how })
  }

  request(botId: string, reason: string): ConnectorRequest {
    const entry = this.entry(botId)
    if (entry.request !== undefined) {
      throw new Error("HANDOFF_PENDING: this bot already waits for a person to take over")
    }
    this.requests += 1
    const request: ConnectorRequest = { id: `handoff-${this.requests}`, reason, since: this.now() }
    entry.request = request
    this.publish(botId, { kind: "requested", request })
    return request
  }

  decline(botId: string): void {
    const request = this.entry(botId).request
    if (request === undefined) return
    this.publish(botId, { kind: "declined", requestId: request.id })
  }

  endRequest(botId: string, requestId: string): void {
    const entry = this.entry(botId)
    if (entry.request?.id !== requestId) return
    entry.request = undefined
    this.publish(botId, { kind: "request-ended", requestId })
  }

  connected(botId: string): void {
    const entry = this.entry(botId)
    entry.connections += 1
    if (entry.connections > 1) entry.notices.add("reconnected")
  }

  takeNotices(botId: string): readonly DesktopNotice[] {
    const entry = this.entry(botId)
    const notices = [...entry.notices]
    entry.notices.clear()
    return notices
  }

  status(botId: string): ConnectorStatus {
    const view = this.view(botId)
    return {
      ...(view.controller === "human" ? { note: OPERATING, operatedBy: "person" as const } : {}),
      ...(view.request === undefined ? {} : { request: view.request }),
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  forget(botId: string): void {
    this.bots.delete(botId)
  }
}
