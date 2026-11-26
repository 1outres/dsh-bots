import type { NoticeTopic } from "./domain"
import type { NoticeEntry, NoticeOutbox } from "./outbox"

export const NOTICE_SOURCES = {
  connector: "bot-connector",
  schedule: "bot-schedule",
  event: "bot-connector-event",
  file: "bot-file",
  session: "bot-session",
  heartbeat: "bot-heartbeat",
  peer: "bot-peer",
  "peer-status": "bot-peer-status",
  "peer-session": "bot-peer-session",
  space: "bot-space",
} as const satisfies Record<NoticeTopic, string>

export type NoticeSourceKind = (typeof NOTICE_SOURCES)[NoticeTopic]

export const NOTICE_TIMINGS = ["next-step", "next-turn"] as const

export type NoticeTiming = (typeof NOTICE_TIMINGS)[number]

export const NOTICE_DELIVERY = {
  connector: "next-step",
  schedule: "next-turn",
  event: "next-turn",
  file: "next-turn",
  session: "next-turn",
  heartbeat: "next-turn",
  peer: "next-turn",
  "peer-status": "next-turn",
  "peer-session": "next-turn",
  space: "next-turn",
} as const satisfies Record<NoticeTopic, NoticeTiming>

export function handOffOf(
  timing: NoticeTiming,
  status: NoticeAgent["status"],
): "followup" | "inject" {
  return status === "running" && timing === "next-step" ? "inject" : "followup"
}

export interface NoticeMessage {
  readonly id: string
  readonly role: "user"
  readonly content: readonly [{ readonly type: "text"; readonly text: string }]
  readonly source: {
    readonly kind: NoticeSourceKind
    readonly form: "notice"
    readonly summary: string
    readonly peerMessages?: readonly string[]
  }
}

export interface NoticeAgent {
  readonly status: "idle" | "running"
  queued(messageId: string): boolean
  unqueue(messageId: string): void
  recorded(messageId: string): boolean
  followup(message: NoticeMessage): void
  inject(message: NoticeMessage): void
}

export interface NoticeDeliveryDeps {
  outbox: Pick<
    NoticeOutbox,
    "pending" | "bots" | "entry" | "byMessage" | "delivered" | "withdraw" | "subscribe"
  >
  admit<T>(botId: string, work: (sessionId: string | undefined) => Promise<T>): Promise<T>
  archived(sessionId: string): boolean
  ready(botId: string): Promise<void>
  resolve(sessionId: string): Promise<NoticeAgent>
  hand(work: () => void): void
  later(ms: number, work: () => void): () => void
  readonly retry: { readonly initialMs: number; readonly maxMs: number }
  warn(message: string): void
}

export interface NoticeDelivery {
  start(): void
  recorded(messageId: string): void
  withdraw(noticeId: string): Promise<NoticeWithdrawal>
  withdrawWhere(matches: (entry: NoticeEntry) => boolean): Promise<readonly NoticeEntry[]>
  idle(sessionId: string): void
  mainChanged(botId: string): void
  dispose(): void
}

export type NoticeWithdrawal = "withdrawn" | "recorded" | "gone"

interface BotState {
  running: boolean
  again: boolean
  failures: number
  retry: (() => void) | undefined
  readonly handed: Map<string, { readonly sessionId: string; lost: boolean }>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function noticeMessage(entry: NoticeEntry): NoticeMessage {
  return Object.freeze({
    id: entry.messageId,
    role: "user",
    content: Object.freeze([Object.freeze({ type: "text", text: entry.text })] as const),
    source: Object.freeze({
      kind: NOTICE_SOURCES[entry.topic],
      form: "notice",
      summary: entry.summary,
      ...(entry.peerMessages === undefined
        ? {}
        : { peerMessages: Object.freeze([...entry.peerMessages]) }),
    }),
  })
}

export function createNoticeDelivery(deps: NoticeDeliveryDeps): NoticeDelivery {
  const states = new Map<string, BotState>()
  let disposed = false
  const stateOf = (botId: string) => {
    let state = states.get(botId)
    if (state === undefined) {
      state = { running: false, again: false, failures: 0, retry: undefined, handed: new Map() }
      states.set(botId, state)
    }
    return state
  }

  const schedule = (botId: string, state: BotState) => {
    if (disposed || state.retry !== undefined) return
    const delay = Math.min(deps.retry.maxMs, deps.retry.initialMs * 2 ** state.failures)
    state.failures += 1
    state.retry = deps.later(delay, () => {
      state.retry = undefined
      kick(botId)
    })
  }

  const pass = async (botId: string, state: BotState): Promise<boolean> => {
    if (deps.outbox.pending(botId).length === 0) return true
    return deps.admit(botId, (sessionId) => handOver(botId, state, sessionId))
  }

  const handOver = async (
    botId: string,
    state: BotState,
    sessionId: string | undefined,
  ): Promise<boolean> => {
    if (sessionId === undefined || deps.archived(sessionId)) return false
    await deps.ready(botId)
    const agent = await deps.resolve(sessionId)
    let complete = true
    for (const entry of deps.outbox.pending(botId)) {
      if (disposed) return true
      if (deps.outbox.entry(entry.id) === undefined) continue
      if (agent.recorded(entry.messageId)) {
        state.handed.delete(entry.id)
        await deps.outbox.delivered(entry.id)
        continue
      }
      const message = noticeMessage(entry)
      if (agent.queued(entry.messageId)) {
        if (agent.status === "idle") {
          deps.hand(() => {
            agent.unqueue(entry.messageId)
            agent.followup(message)
          })
        }
        state.handed.set(entry.id, { sessionId, lost: false })
        continue
      }
      const handed = state.handed.get(entry.id)
      if (handed?.sessionId === sessionId && !handed.lost) {
        if (agent.status === "running") continue
        handed.lost = true
        complete = false
        continue
      }
      deps.hand(() => {
        if (handOffOf(NOTICE_DELIVERY[entry.topic], agent.status) === "inject") {
          agent.inject(message)
        } else {
          agent.followup(message)
        }
      })
      state.handed.set(entry.id, { sessionId, lost: false })
    }
    return complete
  }

  const kick = (botId: string) => {
    if (disposed) return
    const state = stateOf(botId)
    if (state.running) {
      state.again = true
      return
    }
    state.running = true
    state.again = false
    void pass(botId, state)
      .then(
        (complete) => {
          if (complete) state.failures = 0
          else schedule(botId, state)
        },
        (error: unknown) => {
          deps.warn(`bot-core: could not deliver a notice to bot "${botId}": ${messageOf(error)}`)
          schedule(botId, state)
        },
      )
      .finally(() => {
        state.running = false
        if (state.again) kick(botId)
      })
  }

  const withdraw = async (noticeId: string): Promise<NoticeWithdrawal> => {
    const entry = deps.outbox.entry(noticeId)
    if (entry === undefined) return "gone"
    const state = states.get(entry.botId)
    const handed = state?.handed.get(noticeId)
    if (handed !== undefined) {
      const agent = await deps.resolve(handed.sessionId)
      if (deps.outbox.entry(noticeId) === undefined) return "gone"
      if (agent.recorded(entry.messageId)) {
        state?.handed.delete(noticeId)
        await deps.outbox.delivered(noticeId)
        return "recorded"
      }
      if (agent.queued(entry.messageId)) agent.unqueue(entry.messageId)
      state?.handed.delete(noticeId)
    }
    return (await deps.outbox.withdraw(noticeId)) ? "withdrawn" : "gone"
  }

  const offOutbox = deps.outbox.subscribe((botId) => kick(botId))

  return {
    start() {
      for (const botId of deps.outbox.bots()) kick(botId)
    },
    recorded(messageId) {
      const entry = deps.outbox.byMessage(messageId)
      if (entry === undefined) return
      states.get(entry.botId)?.handed.delete(entry.id)
      deps.outbox.delivered(entry.id).catch((error: unknown) => {
        deps.warn(`bot-core: could not mark notice "${entry.id}" delivered: ${messageOf(error)}`)
      })
    },
    withdraw,
    async withdrawWhere(matches) {
      const withdrawn: NoticeEntry[] = []
      for (const botId of deps.outbox.bots()) {
        for (const entry of deps.outbox.pending(botId)) {
          if (matches(entry) && (await withdraw(entry.id)) === "withdrawn") withdrawn.push(entry)
        }
      }
      return withdrawn
    },
    idle(sessionId) {
      for (const [botId, state] of states) {
        if ([...state.handed.values()].some((handed) => handed.sessionId === sessionId)) kick(botId)
      }
    },
    mainChanged(botId) {
      kick(botId)
    },
    dispose() {
      disposed = true
      offOutbox()
      for (const state of states.values()) state.retry?.()
      states.clear()
    },
  }
}
