/**
 * Who operates each bot's desktop: the agent, or a person through one viewer
 * of the screen relay (one stream of the panel). While a person does, the
 * tools that change the screen fail at once; once the agent has it back, its
 * next result says the screen may have changed. Also the bot's open request
 * that a person take over (desktop_request_handoff). State only: the tools,
 * the relay and the handoff consult and change it.
 */
import type { ConnectorRequest, ConnectorStatus } from "@1outres/dsh-bot-core"

export type DesktopController = "agent" | "human"

export type DesktopNotice = "control-returned" | "reconnected"

/** One viewer of a bot's screen, known only in this Host process. */
export type ViewerId = symbol

/** Who holds the input, as one viewer sees it. */
export type ViewerControl = "agent" | "self" | "other"

/** How a person's control ended. */
export type ControlReturn = "handed-back" | "viewer-left"

export interface DesktopControlView {
  readonly controller: DesktopController
  readonly since: number
  readonly request?: ConnectorRequest
}

/** What changed, for those waiting on it (the handoff, the relays). */
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

  /** A person takes the input through `viewer` (from the agent or another viewer). */
  take(botId: string, viewer: ViewerId): void {
    const entry = this.entry(botId)
    if (entry.holder === viewer) return
    const fromAgent = entry.holder === undefined
    entry.holder = viewer
    if (fromAgent) entry.since = this.now()
    this.publish(botId, { kind: "taken" })
  }

  /** The viewer gives the input back to the agent (`viewer-left`: its stream ended). */
  release(botId: string, viewer: ViewerId, how: ControlReturn): void {
    const entry = this.entry(botId)
    if (entry.holder !== viewer) return
    entry.holder = undefined
    entry.since = this.now()
    entry.notices.add("control-returned")
    this.publish(botId, { kind: "returned", how })
  }

  /** The bot asks a person to take over. @throws while it already asks. */
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

  /** A person turns the request down without taking over. */
  decline(botId: string): void {
    const request = this.entry(botId).request
    if (request === undefined) return
    this.publish(botId, { kind: "declined", requestId: request.id })
  }

  /** The request is over (answered, timed out, or the turn stopped). */
  endRequest(botId: string, requestId: string): void {
    const entry = this.entry(botId)
    if (entry.request?.id !== requestId) return
    entry.request = undefined
    this.publish(botId, { kind: "request-ended", requestId })
  }

  /** A new connection to the bot's desktop agent opened; every one after the first is a reconnection. */
  connected(botId: string): void {
    const entry = this.entry(botId)
    entry.connections += 1
    if (entry.connections > 1) entry.notices.add("reconnected")
  }

  /** The notices for the next result, which then has them. */
  takeNotices(botId: string): readonly DesktopNotice[] {
    const entry = this.entry(botId)
    const notices = [...entry.notices]
    entry.notices.clear()
    return notices
  }

  /** The bot's status for bot-core (`BotConnector.status`). */
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
