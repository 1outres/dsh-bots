import type { BotManagedSession } from "../../shared/managed-sessions"
import type {
  DshApprovalOutcome,
  DshApprovalRequest,
  DshQuestionAnswer,
  DshQuestionRequest,
} from "../interactions/dsh"

export interface DshWait {
  readonly id: string
  readonly kind: "question" | "plan-review" | "approval"
  readonly summary: string
}

export interface ManagedWaitsDeps<A> {
  managedOf(agent: A): BotManagedSession | undefined
  opened(session: BotManagedSession, wait: DshWait): void
  newId(): string
}

export interface ManagedWaits<A> {
  question(
    request: DshQuestionRequest<A>,
    next: () => Promise<DshQuestionAnswer>,
  ): Promise<DshQuestionAnswer>
  approval(
    request: DshApprovalRequest<A>,
    next: () => Promise<DshApprovalOutcome>,
  ): Promise<DshApprovalOutcome>
  openIn(sessionId: string): readonly DshWait[]
}

const SUMMARY_MAX = 300

const clip = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
}

export function createManagedWaits<A>(deps: ManagedWaitsDeps<A>): ManagedWaits<A> {
  const open = new Map<string, { readonly sessionId: string; readonly wait: DshWait }>()

  const follow = async <T>(
    agent: A | undefined,
    wait: Omit<DshWait, "id">,
    next: () => Promise<T>,
  ): Promise<T> => {
    const session = agent === undefined ? undefined : deps.managedOf(agent)
    if (session === undefined) return next()
    const entry = { ...wait, id: deps.newId() }
    open.set(entry.id, { sessionId: session.sessionId, wait: entry })
    deps.opened(session, entry)
    try {
      return await next()
    } finally {
      open.delete(entry.id)
    }
  }

  return {
    question: (request, next) =>
      follow(
        request.agent,
        {
          kind: request.questions.some((question) => question.intent?.kind === "plan-review")
            ? "plan-review"
            : "question",
          summary: clip(request.questions.map((question) => question.question).join(" / ")),
        },
        next,
      ),
    approval: (request, next) =>
      follow(
        request.agent,
        {
          kind: "approval",
          summary: clip(
            request.reason === undefined
              ? request.toolName
              : `${request.toolName}: ${request.reason}`,
          ),
        },
        next,
      ),
    openIn: (sessionId) =>
      [...open.values()]
        .filter((entry) => entry.sessionId === sessionId)
        .map((entry) => entry.wait),
  }
}
