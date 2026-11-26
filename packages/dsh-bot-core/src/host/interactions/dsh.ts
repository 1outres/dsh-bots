export interface DshLocalized {
  readonly en: string
  readonly [locale: string]: string
}

export type DshQuestionIntent =
  | { readonly kind: "plan-review"; readonly approve: string; readonly callId?: string }
  | {
      readonly kind: "approval"
      readonly approve: string
      readonly reject: string
      readonly always?: string
      readonly subject?: { readonly name: string; readonly icon?: string }
      readonly display?: {
        readonly question: DshLocalized
        readonly detail?: DshLocalized
        readonly approve?: DshLocalized
      }
    }

export interface DshQuestionItem {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
  readonly intent?: DshQuestionIntent
}

export interface DshAnswerItem {
  readonly id: string
  readonly selected: string[]
  readonly custom?: string
}

export interface DshQuestionAnswer {
  readonly answers: DshAnswerItem[]
}

export interface DshQuestionRequest<A> {
  readonly questions: readonly DshQuestionItem[]
  readonly agent?: A
  readonly signal?: AbortSignal
  readonly wait?: { readonly callId: string; readonly timed?: boolean }
}

export interface DshApprovalRequest<A> {
  readonly agent: A
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly displayReason?: DshLocalized
  readonly signal?: AbortSignal
}

export type DshApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable"

export interface DshPendingQuestion {
  readonly callId: string
  readonly questions: readonly DshQuestionItem[]
  readonly state: "open" | "continued"
}

export type DshQuestionRejection = "ASK_ABORTED" | "ASK_CANCELLED" | "ASK_TIMED_OUT"

const REJECTION_MESSAGES: Readonly<Record<DshQuestionRejection, string>> = {
  ASK_ABORTED: "ask_user_question was aborted before the user answered",
  ASK_CANCELLED: "the user cancelled ask_user_question",
  ASK_TIMED_OUT: "ask_user_question timed out before the user answered",
}

export function questionRejection(code: DshQuestionRejection): Error {
  const error = new Error(REJECTION_MESSAGES[code]) as Error & { code: string }
  error.name = "UserQuestionError"
  error.code = code
  return error
}

export function questionErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const value = error as { name?: unknown; code?: unknown }
  return value.name === "UserQuestionError" && typeof value.code === "string"
    ? value.code
    : undefined
}
