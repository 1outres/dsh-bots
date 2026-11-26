/**
 * A bot's Main as its channels see it (docs/specs/bot-main-view.md): the
 * people's messages, the bot's replies and presented files, and how its turns
 * ended, across every Main the bot had, as one conversation.
 */

/** Where an item sits: a session of the bot's Mains and the log position it came from. */
export interface MainTimelinePosition {
  readonly sessionId: string
  readonly seq: number
}

/** Who wrote a person's message. */
export type MainMessageAuthor =
  /** The owner, in DSH's Web UI. */
  | { readonly kind: "web" }
  /** A person on a chat channel, as the message's header line names them. */
  | {
      readonly kind: "channel"
      /** The channel's display name ("Discord"). */
      readonly channel: string
      /** Where it was written there ("DM"). */
      readonly place: string
      readonly name: string
      readonly handle: string
      readonly owner: boolean
      readonly bot: boolean
    }

/** An image a person sent, read through {@link BotMainViewApi.image}. */
export interface MainTimelineImage {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** A file a person sent: `path` when it was saved in the bot's workspace. */
export interface MainTimelineFile {
  readonly name: string
  readonly size: string
  readonly path?: string
}

/** A file the bot presented, by its path in the bot's environment. */
export interface MainPresentedFile {
  readonly path: string
  readonly name: string
  readonly description?: string
}

interface MainTimelineEntry extends MainTimelinePosition {
  readonly id: string
  /** When it was logged (epoch ms). */
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
  /** Markdown. */
  readonly text: string
  readonly interrupted: boolean
}

export interface MainPresentedFiles extends MainTimelineEntry {
  readonly kind: "presented"
  readonly files: readonly MainPresentedFile[]
}

/** A turn that did not complete: `failed` with the reason, or `stopped`. */
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

/** Where older items continue: before this position, then in the Mains before it. */
export type MainTimelineCursor = MainTimelinePosition

/**
 * One frame of a bot's timeline stream. A stream starts with `start`, the
 * newest items (they may reach into former Mains); every `next` carries the
 * items logged since, oldest first. `replying`: a turn the channels see runs.
 */
export type MainTimelineFrame =
  | {
      readonly kind: "start"
      readonly mainSessionId: string
      readonly items: readonly MainTimelineItem[]
      /** Absent when nothing is older. */
      readonly earlier?: MainTimelineCursor
      readonly replying: boolean
    }
  | {
      readonly kind: "next"
      readonly mainSessionId: string
      readonly items: readonly MainTimelineItem[]
      readonly replying: boolean
    }

/** Items before a cursor, oldest first. */
export interface MainTimelinePage {
  readonly items: readonly MainTimelineItem[]
  readonly earlier?: MainTimelineCursor
}

export interface MainTimelineImageData {
  readonly mediaType: string
  /** Base64. */
  readonly data: string
}

/** Items a start frame or a page holds at most. */
export const MAIN_TIMELINE_PAGE = 40

export interface BotMainViewApi {
  /** The bot's timeline: its newest items now, then every new one, while watched. */
  watch(botId: string, signal?: AbortSignal): AsyncIterable<MainTimelineFrame>
  /** @throws when `before` is not in one of the bot's Mains. */
  page(botId: string, before: MainTimelineCursor, signal?: AbortSignal): Promise<MainTimelinePage>
  /** @throws when no person's message of the bot's Mains holds the image. */
  image(
    botId: string,
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<MainTimelineImageData>
}
