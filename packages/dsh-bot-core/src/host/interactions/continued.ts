import type { BotAnswerResult } from "../../shared/interactions"
import type {
  InteractionBoard,
  InteractionPlace,
  InteractionResponder,
  OpenInteraction,
} from "./board"
import { type DshPendingQuestion, type DshQuestionAnswer, questionErrorCode } from "./dsh"
import { botQuestionOf, type QuestionPresentation, replyOf } from "./presentation"

export interface ContinuedQuestionsDeps {
  board: Pick<InteractionBoard, "open">
  /** The bot session `sessionId` is, while its root Agent is live. */
  placeOf(sessionId: string): InteractionPlace | undefined
  /** The session's `userQuestions` projection rows; undefined without a live Agent. */
  rows(sessionId: string): readonly DshPendingQuestion[] | undefined
  /**
   * DSH's `userQuestions.answer`: steer a late reply into the session's root
   * Agent (resumed first). False when the call is no longer continued; throws
   * its `UserQuestionError` (`REPLY_QUEUED`, `BAD_ANSWER`).
   */
  reply(sessionId: string, callId: string, answer: DshQuestionAnswer): Promise<boolean>
}

/**
 * The timed questions of bot sessions after their foreground wait: DSH's
 * `userQuestions` projection lists a call as `continued` once its tool call
 * returned pending (or the process that owned it ended), and it stays
 * answerable by a late reply until that reply is admitted. bot-core keeps
 * every such call on the board, answered through `userQuestions.answer`, and
 * withdraws a call the projection no longer lists.
 */
export interface ContinuedQuestions {
  /**
   * A live request's interaction whose foreground wait of call `callId`
   * ended: answered as a late reply from now on, and followed like the
   * projection's other continued calls.
   */
  adopt(entry: OpenInteraction, callId: string, presentation: QuestionPresentation): void
  /** Follow the session's projection rows. */
  reconcile(sessionId: string): void
  /** A late reply to `callId` was discarded before the Agent admitted it: the call is answerable again. */
  released(sessionId: string, callId: string): void
}

interface Tracked {
  readonly sessionId: string
  readonly callId: string
  readonly entry: OpenInteraction
  /** The projection listed the call since it was tracked. */
  seen: boolean
}

const keyOf = (sessionId: string, callId: string) => `${sessionId}\u0000${callId}`

export function createContinuedQuestions(deps: ContinuedQuestionsDeps): ContinuedQuestions {
  const tracked = new Map<string, Tracked>()

  const lateResponder = (
    sessionId: string,
    callId: string,
    presentation: QuestionPresentation,
  ): InteractionResponder => ({
    async answer(answer): Promise<BotAnswerResult> {
      const reply = replyOf(presentation, answer)
      if (reply.kind !== "answer") {
        return { accepted: false, reason: "invalid", message: "This question needs an answer." }
      }
      try {
        const delivered = await deps.reply(sessionId, callId, reply.answer)
        return delivered
          ? { accepted: true }
          : {
              accepted: false,
              reason: "not-open",
              message: "This is no longer waiting for an answer.",
            }
      } catch (error) {
        switch (questionErrorCode(error)) {
          case "REPLY_QUEUED":
            return {
              accepted: false,
              reason: "not-open",
              message: "A reply to this question is already waiting for the bot.",
            }
          case "BAD_ANSWER":
            return { accepted: false, reason: "invalid", message: (error as Error).message }
          default:
            return {
              accepted: false,
              reason: "failed",
              message: error instanceof Error ? error.message : String(error),
            }
        }
      }
    },
  })

  const listed = (sessionId: string, callId: string): boolean =>
    deps.rows(sessionId)?.some((row) => row.callId === callId) === true

  const reconcile = (sessionId: string) => {
    const place = deps.placeOf(sessionId)
    const rows = deps.rows(sessionId)
    if (place === undefined || rows === undefined) return
    const active = new Set(rows.map((row) => row.callId))
    for (const [key, item] of [...tracked]) {
      if (item.sessionId !== sessionId) continue
      if (active.has(item.callId)) {
        item.seen = true
        continue
      }
      if (!item.seen && item.entry.isOpen()) continue
      tracked.delete(key)
      if (item.entry.isOpen()) item.entry.withdraw()
    }
    for (const row of rows) {
      if (row.state !== "continued" || tracked.has(keyOf(sessionId, row.callId))) continue
      const presentation: QuestionPresentation = {
        kind: "question",
        questions: row.questions.map(botQuestionOf),
      }
      const entry = deps.board.open(
        place,
        (id) => ({
          id,
          kind: "question",
          questions: presentation.questions,
          wait: { state: "continued" },
        }),
        lateResponder(sessionId, row.callId, presentation),
      )
      tracked.set(keyOf(sessionId, row.callId), {
        sessionId,
        callId: row.callId,
        entry,
        seen: true,
      })
    }
  }

  return {
    adopt(entry, callId, presentation) {
      const { sessionId } = entry.place
      entry.respondWith(lateResponder(sessionId, callId, presentation))
      tracked.set(keyOf(sessionId, callId), {
        sessionId,
        callId,
        entry,
        seen: listed(sessionId, callId),
      })
    },
    reconcile,
    released(sessionId, callId) {
      const key = keyOf(sessionId, callId)
      const item = tracked.get(key)
      if (item === undefined || item.entry.isOpen()) return
      tracked.delete(key)
      reconcile(sessionId)
    },
  }
}
