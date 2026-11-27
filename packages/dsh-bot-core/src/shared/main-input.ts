export type MainInputActivity = "idle" | "running"

export type MainInputMode = "queue" | "steer"

export interface MainInputImageLimits {
  readonly mediaTypes: readonly string[]
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
}

export interface MainInputLimits {
  readonly maxCount: number
  readonly maxFileBytes: number
  readonly maxMessageBytes: number
  readonly chunkBytes: number
  readonly images?: MainInputImageLimits
}

export interface MainInputState {
  readonly botId: string
  readonly mainSessionId?: string
  readonly activity: MainInputActivity
  readonly limits: MainInputLimits
}

export type MainInputFailureCode =
  | "not-owner"
  | "unknown-bot"
  | "no-main-session"
  | "closed"
  | "empty"
  | "too-many-attachments"
  | "too-large"
  | "unknown-attachment"
  | "incomplete-attachment"
  | "unreadable"
  | "environment-unavailable"
  | "save-failed"
  | "rejected"

export interface MainInputFailure {
  readonly code: MainInputFailureCode
  readonly message: string
}

export interface MainStageRequest {
  readonly draft: string
  readonly name: string
  readonly mediaType?: string
  readonly bytes: number
}

export type MainStageResult =
  | { readonly staged: true; readonly attachmentId: string }
  | { readonly staged: false; readonly failure: MainInputFailure }

export type MainAppendResult =
  | { readonly appended: true; readonly received: number; readonly complete: boolean }
  | { readonly appended: false; readonly failure: MainInputFailure }

export interface MainInputSubmission {
  readonly text: string
  readonly attachments: readonly string[]
}

export type MainSendResult =
  | { readonly sent: true; readonly sessionId: string; readonly mode: MainInputMode }
  | { readonly sent: false; readonly failure: MainInputFailure }

export type MainStopResult =
  | { readonly ok: true; readonly outcome: "stopped" | "idle" }
  | { readonly ok: false; readonly message: string }

export interface BotMainInputApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<MainInputState>
  stage(botId: string, request: MainStageRequest): Promise<MainStageResult>
  append(
    botId: string,
    attachmentId: string,
    offset: number,
    data: string,
  ): Promise<MainAppendResult>
  discard(botId: string, attachmentId: string): Promise<{ readonly discarded: boolean }>
  send(botId: string, submission: MainInputSubmission): Promise<MainSendResult>
  stop(botId: string): Promise<MainStopResult>
}
