export interface MainTimelinePosition {
  readonly sessionId: string
  readonly seq: number
}

export type MainMessageAuthor =
  | { readonly kind: "web" }
  | {
      readonly kind: "channel"
      readonly channel: string
      readonly place: string
      readonly name: string
      readonly handle: string
      readonly owner: boolean
      readonly bot: boolean
    }

export interface MainTimelineImage {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface MainTimelineFile {
  readonly name: string
  readonly size: string
  readonly path?: string
}

export interface MainPresentedFile {
  readonly path: string
  readonly name: string
  readonly description?: string
}

interface MainTimelineEntry extends MainTimelinePosition {
  readonly id: string
  readonly at: number
}

export interface MainPersonMessage extends MainTimelineEntry {
  readonly kind: "person"
  readonly author: MainMessageAuthor
  readonly text: string
  readonly images: readonly MainTimelineImage[]
  readonly files: readonly MainTimelineFile[]
}

export interface MainBotReply extends MainTimelineEntry {
  readonly kind: "reply"
  readonly text: string
  readonly interrupted: boolean
}

export interface MainPresentedFiles extends MainTimelineEntry {
  readonly kind: "presented"
  readonly files: readonly MainPresentedFile[]
}

export interface MainTurnOutcome extends MainTimelineEntry {
  readonly kind: "turn"
  readonly outcome:
    | { readonly kind: "failed"; readonly message: string }
    | { readonly kind: "stopped"; readonly by: "user" | "system" }
}

export type MainTimelineItem =
  | MainPersonMessage
  | MainBotReply
  | MainPresentedFiles
  | MainTurnOutcome

export type MainTimelineCursor = MainTimelinePosition

export type MainTimelineFrame =
  | {
      readonly kind: "start"
      readonly mainSessionId: string
      readonly items: readonly MainTimelineItem[]
      readonly earlier?: MainTimelineCursor
      readonly replying: boolean
    }
  | {
      readonly kind: "next"
      readonly mainSessionId: string
      readonly items: readonly MainTimelineItem[]
      readonly replying: boolean
    }

export interface MainTimelinePage {
  readonly items: readonly MainTimelineItem[]
  readonly earlier?: MainTimelineCursor
}

export interface MainTimelineImageData {
  readonly mediaType: string
  readonly data: string
}

export const MAIN_TIMELINE_PAGE = 40

export interface BotMainViewApi {
  watch(botId: string, signal?: AbortSignal): AsyncIterable<MainTimelineFrame>
  page(botId: string, before: MainTimelineCursor, signal?: AbortSignal): Promise<MainTimelinePage>
  image(
    botId: string,
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<MainTimelineImageData>
}
