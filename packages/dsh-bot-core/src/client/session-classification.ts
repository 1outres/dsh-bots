import { type BotsSnapshot, type BotView, sessionsOfBot } from "../shared/bots"
import { botIdOfPreset } from "../shared/preset"
import type { SessionListState } from "./dsh/context"
import type { MainBinding } from "./main-session"
import { derive, type Observable } from "./observable"

export type SessionClass =
  | { readonly kind: "unknown" }
  | { readonly kind: "stock" }
  | {
      readonly kind: "bot"
      readonly botId: string | undefined
      readonly bot: BotView | undefined
      readonly source: "bots" | "preset"
    }

export type BotsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotsSnapshot }
  | { readonly status: "reconnecting"; readonly snapshot: BotsSnapshot }
  | { readonly status: "unavailable"; readonly error?: string }
  | { readonly status: "failed"; readonly error: string }

export type RegistrationStatus =
  | { readonly state: "idle" | "active" }
  | { readonly state: "refused"; readonly error: string }

const UNKNOWN: SessionClass = { kind: "unknown" }
const STOCK: SessionClass = { kind: "stock" }

export function snapshotOf(state: BotsState): BotsSnapshot | undefined {
  switch (state.status) {
    case "ready":
    case "reconnecting":
      return state.snapshot
    case "loading":
    case "unavailable":
    case "failed":
      return undefined
  }
}

export function botSessionIds(snapshot: BotsSnapshot): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const pending of snapshot.pending) {
    for (const id of pending.sessionIds) ids.add(id)
  }
  for (const bot of snapshot.bots) {
    for (const id of sessionsOfBot(bot)) ids.add(id)
  }
  return ids
}

export function botOfSession(bots: readonly BotView[], sessionId: string): BotView | undefined {
  return bots.find((bot) => sessionsOfBot(bot).includes(sessionId))
}

function classifyByBots(snapshot: BotsSnapshot, sessionId: string): SessionClass {
  const bot = botOfSession(snapshot.bots, sessionId)
  if (bot !== undefined) return { kind: "bot", botId: bot.id, bot, source: "bots" }
  if (snapshot.pending.some((pending) => pending.sessionIds.includes(sessionId))) {
    return { kind: "bot", botId: undefined, bot: undefined, source: "bots" }
  }
  return STOCK
}

function classifyByPreset(sessions: SessionListState, sessionId: string): SessionClass {
  if (sessions.phase !== "ready") return UNKNOWN
  const preset = sessions.byId[sessionId]?.projectionValues?.agentPreset
  if (preset === undefined) return UNKNOWN
  if (preset === null) return STOCK
  const botId = botIdOfPreset(preset)
  if (botId === undefined) return STOCK
  return { kind: "bot", botId, bot: undefined, source: "preset" }
}

export function classifySession(
  bots: BotsState,
  sessions: SessionListState,
  sessionId: string,
): SessionClass {
  const snapshot = snapshotOf(bots)
  return snapshot === undefined
    ? classifyByPreset(sessions, sessionId)
    : classifyByBots(snapshot, sessionId)
}

export function sameClass(a: SessionClass, b: SessionClass): boolean {
  if (a.kind !== "bot" || b.kind !== "bot") return a.kind === b.kind
  return a.botId === b.botId && a.bot === b.bot && a.source === b.source
}

export interface SessionClassifierSources {
  readonly main: Observable<MainBinding>
  readonly bots: Observable<BotsState>
  readonly sessions: Observable<SessionListState>
}

export interface SessionClassifier {
  readonly main: Observable<SessionClass>
  classify(sessionId: string): SessionClass
}

function classifyMain(
  binding: MainBinding,
  bots: BotsState,
  sessions: SessionListState,
): SessionClass {
  switch (binding.kind) {
    case "settling":
      return UNKNOWN
    case "none":
      return STOCK
    case "session":
      return classifySession(bots, sessions, binding.sessionId)
  }
}

export function createSessionClassifier(sources: SessionClassifierSources): SessionClassifier {
  return {
    main: derive([sources.main, sources.bots, sources.sessions], classifyMain, sameClass),
    classify: (sessionId) =>
      classifySession(sources.bots.getSnapshot(), sources.sessions.getSnapshot(), sessionId),
  }
}
