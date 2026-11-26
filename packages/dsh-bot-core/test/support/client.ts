import type { ActionsHub } from "../../src/client/approvals/hub"
import type { ConnectorPanelsFace } from "../../src/client/connector-panels/face"
import type {
  ConnectorPanelPlace,
  ConnectorPanelPlaces,
} from "../../src/client/connector-panels/places"
import { FORMAT_LOCALE_KEY } from "../../src/client/locale-format"
import { constant } from "../../src/client/observable"
import type { InquiriesHub } from "../../src/client/senders/inquiries"
import type { Observable, Translate } from "../../src/client/types"
import type { BotView, CreationPhase, PendingBotView } from "../../src/shared/bots"

export const bot = (id: string, mainSessionId: string, sessionIds: string[] = []): BotView => ({
  id,
  name: `Bot ${id}`,
  avatar: { kind: "character", character: "capsule", color: "#6366F1" },
  mainSessionId,
  mainStartedAt: 0,
  timezone: "UTC",
  sessionIds,
  formerMainIds: [],
  createdAt: 0,
})

export const creating = (
  id: string,
  sessionIds: string[] = [],
  phase: CreationPhase = "queued",
): PendingBotView => ({
  id,
  name: `Bot ${id}`,
  avatar: { kind: "character", character: "capsule", color: "#6366F1" },
  operation: { kind: "create", phase },
  startedAt: 0,
  sessionIds,
  createdAt: 0,
})

export function value<T>(initial: T): Observable<T> & { set(next: T): void } {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next) {
      current = next
      for (const listener of [...listeners]) listener()
    },
  }
}

export const t: Translate = (key, params) => {
  if (key === FORMAT_LOCALE_KEY) return "en"
  return params === undefined ? key : `${key}(${Object.values(params).join(",")})`
}

export const translateWith =
  (dictionary: Readonly<Record<string, string>>): Translate =>
  (key, params) =>
    (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
      params !== undefined && name in params ? String(params[name]) : match,
    )

const idlePlace: ConnectorPanelPlace = {
  shows: () => constant(false),
  open: () => {},
  toggle: () => {},
}

export const idlePlaces: ConnectorPanelPlaces = { side: idlePlace, popover: idlePlace }

export const idleConnectorPanels: ConnectorPanelsFace = {
  connectors: {
    feed: () => ({
      getSnapshot: () => ({ status: "loading" }),
      subscribe: () => () => {},
      configure: () => Promise.reject(new Error("idle")),
      setPermission: () => Promise.reject(new Error("idle")),
      retry: () => Promise.reject(new Error("idle")),
    }),
  },
  places: idlePlaces,
  width: { getSnapshot: () => 720, subscribe: () => () => {}, resize: () => {} },
  text: (value) => value.en,
  openStream: () => {
    throw new Error("idle")
  },
}

export const idleInquiries: InquiriesHub = {
  feed: () => ({
    getSnapshot: () => ({ status: "loading" }),
    subscribe: () => () => {},
    answer: async () => ({ kind: "unreachable", message: "idle" }),
  }),
}

export const idleApprovals: ActionsHub = {
  feed: () => ({
    getSnapshot: () => ({ status: "loading" }),
    subscribe: () => () => {},
    decide: async () => ({ kind: "unreachable", message: "idle" }),
  }),
}
