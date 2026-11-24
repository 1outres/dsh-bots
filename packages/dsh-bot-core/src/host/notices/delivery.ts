import type { NoticeTopic } from "./domain"
import type { NoticeEntry, NoticeOutbox } from "./outbox"

/** The message source of each topic (declared on dsh-llm's MessageSourceMap in src/index.ts). */
export const NOTICE_SOURCES = {
  connector: "bot-connector",
  schedule: "bot-schedule",
  event: "bot-connector-event",
  file: "bot-file",
  session: "bot-session",
} as const satisfies Record<NoticeTopic, string>

export type NoticeSourceKind = (typeof NOTICE_SOURCES)[NoticeTopic]

/**
 * When a notice may reach a Main session that is running a turn:
 * `next-step` joins that turn at its next step (the outcome of something
 * the turn may be waiting on); `next-turn` waits for the turn to end and
 * opens its own turn (work of its own, which must not mix into an unrelated
 * turn, e.g. one `stay_silent` would then silence too). An idle Main is
 * woken either way.
 */
export const NOTICE_TIMINGS = ["next-step", "next-turn"] as const

export type NoticeTiming = (typeof NOTICE_TIMINGS)[number]

export const NOTICE_DELIVERY = {
  connector: "next-step",
  schedule: "next-turn",
  event: "next-turn",
  file: "next-turn",
  session: "next-turn",
} as const satisfies Record<NoticeTopic, NoticeTiming>

/** How a notice is handed to the Agent: `followup` queues its own turn (waking an idle Agent), `inject` joins the running turn. */
export function handOffOf(
  timing: NoticeTiming,
  status: NoticeAgent["status"],
): "followup" | "inject" {
  return status === "running" && timing === "next-step" ? "inject" : "followup"
}

/** The user-role message that carries a notice; its id is fixed per notice. */
export interface NoticeMessage {
  readonly id: string
  readonly role: "user"
  readonly content: readonly [{ readonly type: "text"; readonly text: string }]
  readonly source: {
    readonly kind: NoticeSourceKind
    readonly form: "notice"
    readonly summary: string
  }
}

/** The slice of a live Main session Agent delivery uses. */
export interface NoticeAgent {
  readonly status: "idle" | "running"
  /** Whether a message with this id waits in its inbox (either list). */
  queued(messageId: string): boolean
  /** Take a waiting message out of its inbox. */
  unqueue(messageId: string): void
  /** Whether the session's history has the message. */
  recorded(messageId: string): boolean
  /** Queue as its own turn, after a running one, and wake the Agent. */
  followup(message: NoticeMessage): void
  /** Add to the running turn's next step. */
  inject(message: NoticeMessage): void
}

export interface NoticeDeliveryDeps {
  outbox: Pick<NoticeOutbox, "pending" | "bots" | "byMessage" | "delivered" | "subscribe">
  /**
   * Hand notices to the bot's Main as an input (host/mains/controller.ts
   * `admit`): `work` runs with the Main they go to once no maintenance holds the bot.
   */
  admit<T>(botId: string, work: (sessionId: string | undefined) => Promise<T>): Promise<T>
  /** Whether the Workspace registry lists the session as archived (it runs no step then). */
  archived(sessionId: string): boolean
  /** Settles once the bot's sessions can be resumed (its preset registered), or after a bound. */
  ready(botId: string): Promise<void>
  /** The session's live Agent, resumed if needed. @throws when it cannot be. */
  resolve(sessionId: string): Promise<NoticeAgent>
  /** Hand messages over outside any Agent's initiator scope. */
  hand(work: () => void): void
  later(ms: number, work: () => void): () => void
  readonly retry: { readonly initialMs: number; readonly maxMs: number }
  warn(message: string): void
}

/**
 * Delivers the outbox to bots' Main sessions. A notice counts as delivered
 * only once its message is recorded in the session (`recorded`): until
 * then each pass looks again, wakes an idle Agent whose inbox still holds
 * it, and sends it again (same message id) when the inbox lost it. An idle
 * Agent is woken (followup); a running one gets it as its topic's
 * {@link NOTICE_DELIVERY} says: at its next step (inject), or as the turn
 * after it (followup). Either way a notice waiting in the inbox of a running
 * Agent is left alone, and one the inbox lost is sent again once the Agent is idle.
 */
export interface NoticeDelivery {
  /** Deliver every stored notice (start-up). */
  start(): void
  /** A user message was recorded in a session (`session/event`). */
  recorded(messageId: string): void
  /** A session's Agent became idle: notices handed to it may need another pass. */
  idle(sessionId: string): void
  /** The bot's Main changed: its notices go to the new one. */
  mainChanged(botId: string): void
  dispose(): void
}

interface BotState {
  running: boolean
  again: boolean
  failures: number
  retry: (() => void) | undefined
  /**
   * Notices handed to a session and not seen recorded yet; `lost` once a pass
   * found the Agent idle without it (its turn dropped it): sent again on the next pass.
   */
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

  /** One look at the bot's notices; true when every one is recorded or handed over. */
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
      if (agent.recorded(entry.messageId)) {
        state.handed.delete(entry.id)
        await deps.outbox.delivered(entry.id)
        continue
      }
      const message = noticeMessage(entry)
      if (agent.queued(entry.messageId)) {
        // A restored inbox does not wake an idle Agent: queue it again to open the turn.
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
