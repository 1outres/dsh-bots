import type { BotAnswerResult, BotQuestionWait } from "../../shared/interactions"
import type { InteractionBoard, InteractionPlace, OpenInteraction } from "./board"
import type { ContinuedQuestions } from "./continued"
import {
  type DshApprovalOutcome,
  type DshApprovalRequest,
  type DshQuestionAnswer,
  type DshQuestionRequest,
  questionRejection,
} from "./dsh"
import { createForegroundWait, type ForegroundWait } from "./foreground-wait"
import {
  approvalOutcomeOf,
  interactionOfApproval,
  interactionOfQuestions,
  presentQuestions,
  replyOf,
} from "./presentation"

export interface WaitClaim {
  readonly remainingMs: number
  release(): void
}

export interface QuestionAnswererDeps<A> {
  board: Pick<InteractionBoard, "open">
  continued: Pick<ContinuedQuestions, "adopt">
  place(agent: A): InteractionPlace | undefined
  claim(agent: A, callId: string): Promise<WaitClaim | undefined>
  now(): number
  later(ms: number, work: () => void): () => void
}

export interface ApprovalAnswererDeps<A> {
  board: Pick<InteractionBoard, "open">
  place(agent: A): { readonly place: InteractionPlace; readonly delegated: boolean } | undefined
}

export interface Answerer<Request, Result> {
  answer(request: Request, next: () => Promise<Result>): Promise<Result>
  delegateAll(): void
}

const NOT_OPEN: BotAnswerResult = {
  accepted: false,
  reason: "not-open",
  message: "This is no longer waiting for an answer.",
}

interface Deferred<T> {
  resolve(value: T | Promise<T>): void
  reject(reason: unknown): void
}

function createSettlement<T>(signal: AbortSignal | undefined, onAbort: () => void) {
  let settled = false
  const cleanups: (() => void)[] = []
  const abort = () => onAbort()
  signal?.addEventListener("abort", abort, { once: true })
  cleanups.push(() => signal?.removeEventListener("abort", abort))
  let deferred: Deferred<T> = { resolve: () => {}, reject: () => {} }
  const promise = new Promise<T>((resolve, reject) => {
    deferred = { resolve, reject }
  })
  return {
    promise,
    onSettle(cleanup: () => void) {
      cleanups.push(cleanup)
    },
    finish(settle: (deferred: Deferred<T>) => void): boolean {
      if (settled) return false
      settled = true
      for (const cleanup of cleanups) cleanup()
      settle(deferred)
      return true
    },
  }
}

type Settlement<T> = ReturnType<typeof createSettlement<T>>

function createHeldRequests() {
  const delegates = new Set<() => void>()
  return {
    hold<T>(settlement: Settlement<T>, entry: OpenInteraction, next: () => Promise<T>) {
      const delegate = () => {
        settlement.finish(({ resolve }) => {
          entry.withdraw()
          resolve(next())
        })
      }
      delegates.add(delegate)
      settlement.onSettle(() => delegates.delete(delegate))
    },
    delegateAll() {
      for (const delegate of [...delegates]) delegate()
    },
  }
}

export function createQuestionAnswerer<A>(
  deps: QuestionAnswererDeps<A>,
): Answerer<DshQuestionRequest<A>, DshQuestionAnswer> {
  const held = createHeldRequests()

  async function answer(
    request: DshQuestionRequest<A>,
    next: () => Promise<DshQuestionAnswer>,
  ): Promise<DshQuestionAnswer> {
    const { agent, signal } = request
    const place = agent === undefined ? undefined : deps.place(agent)
    if (agent === undefined || place === undefined) return next()
    const aborted = () => signal?.reason ?? questionRejection("ASK_ABORTED")
    if (signal?.aborted) throw aborted()
    const timedCall = request.wait?.timed === true ? request.wait.callId : undefined
    const presentation = presentQuestions(request.questions, timedCall !== undefined)
    const claim = timedCall === undefined ? undefined : await deps.claim(agent, timedCall)
    if (timedCall !== undefined && claim === undefined) throw aborted()
    if (signal?.aborted) {
      claim?.release()
      throw aborted()
    }

    let entry: OpenInteraction | undefined
    const settlement = createSettlement<DshQuestionAnswer>(signal, () => {
      settlement.finish(({ reject }) => {
        entry?.withdraw()
        reject(aborted())
      })
    })
    let wait: ForegroundWait | undefined
    if (claim !== undefined && timedCall !== undefined) {
      const counting = createForegroundWait({
        remainingMs: claim.remainingMs,
        now: deps.now,
        later: deps.later,
        changed: (next: BotQuestionWait) => {
          entry?.update(interactionOfQuestions(entry.id, presentation, next))
        },
        expired: () => {
          if (!settlement.finish(({ reject }) => reject(questionRejection("ASK_TIMED_OUT")))) return
          if (entry !== undefined) deps.continued.adopt(entry, timedCall, presentation)
        },
      })
      settlement.onSettle(() => counting.stop())
      settlement.onSettle(() => claim.release())
      wait = counting
    }
    const opened = deps.board.open(
      place,
      (id) => interactionOfQuestions(id, presentation, wait?.current()),
      {
        async answer(answer) {
          const reply = replyOf(presentation, answer)
          return settlement.finish(({ resolve, reject }) => {
            if (reply.kind === "answer") resolve(reply.answer)
            else reject(questionRejection("ASK_CANCELLED"))
          })
            ? { accepted: true }
            : NOT_OPEN
        },
        ...(wait === undefined ? {} : { hold: () => wait?.hold() }),
      },
    )
    entry = opened
    held.hold(settlement, opened, next)
    return settlement.promise
  }

  return { answer, delegateAll: held.delegateAll }
}

export function createApprovalAnswerer<A>(
  deps: ApprovalAnswererDeps<A>,
): Answerer<DshApprovalRequest<A>, DshApprovalOutcome> {
  const held = createHeldRequests()

  async function answer(
    request: DshApprovalRequest<A>,
    next: () => Promise<DshApprovalOutcome>,
  ): Promise<DshApprovalOutcome> {
    const found = deps.place(request.agent)
    if (found === undefined) return next()
    if (request.signal?.aborted) return "cancelled"
    let entry: OpenInteraction | undefined
    const settlement = createSettlement<DshApprovalOutcome>(request.signal, () => {
      settlement.finish(({ resolve }) => {
        entry?.withdraw()
        resolve("cancelled")
      })
    })
    const opened = deps.board.open(
      found.place,
      (id) => interactionOfApproval(id, request, found.delegated),
      {
        async answer(answer) {
          const outcome = approvalOutcomeOf(answer)
          return settlement.finish(({ resolve }) => resolve(outcome))
            ? { accepted: true }
            : NOT_OPEN
        },
      },
    )
    entry = opened
    held.hold(settlement, opened, next)
    return settlement.promise
  }

  return { answer, delegateAll: held.delegateAll }
}
