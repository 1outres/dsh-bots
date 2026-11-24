import type { BotView } from "../../shared/bots"
import type { BotsState, RegistrationStatus, SessionClass } from "../session-classification"
import type { ViewerNotice } from "../viewer"

export type ShellBot =
  | { readonly kind: "known"; readonly bot: BotView }
  | { readonly kind: "pending" }

/** What the `main.conversation` entry draws. */
export type ShellView =
  | { readonly kind: "classifying" }
  | { readonly kind: "stock" }
  | { readonly kind: "bot"; readonly sessionId: string; readonly bot: ShellBot }
  /** The creation progress of a bot, over whatever session the main view is bound to. */
  | { readonly kind: "progress"; readonly botId: string }

const CLASSIFYING: ShellView = { kind: "classifying" }
const STOCK: ShellView = { kind: "stock" }
const PENDING: ShellBot = { kind: "pending" }

/**
 * A bot's creation progress, once asked for, comes first. Otherwise unknown is
 * neutral, with or without a session yet; a settled main view without a session is stock.
 */
export function shellView(
  sessionId: string | undefined,
  session: SessionClass,
  progress: string | null,
): ShellView {
  if (progress !== null) return { kind: "progress", botId: progress }
  switch (session.kind) {
    case "unknown":
      return CLASSIFYING
    case "stock":
      return STOCK
    case "bot":
      if (sessionId === undefined) return CLASSIFYING
      if (session.bot === undefined) return { kind: "bot", sessionId, bot: PENDING }
      return { kind: "bot", sessionId, bot: { kind: "known", bot: session.bot } }
  }
}

export type ConnectionNotice = "reconnecting" | "unavailable"

/** What a bot session says about the bots list it is drawn from. */
export function connectionNotice(state: BotsState): ConnectionNotice | undefined {
  switch (state.status) {
    case "loading":
    case "ready":
      return undefined
    case "reconnecting":
      return "reconnecting"
    case "unavailable":
    case "failed":
      return "unavailable"
  }
}

export type ShellNoticeView =
  | { readonly kind: "lockdown" }
  | { readonly kind: "viewer"; readonly notice: ViewerNotice }

/** The one notice a bot session's header shows: a refused lockdown, until dismissed, outranks the viewer's. */
export function shellNotice(
  registration: RegistrationStatus,
  lockdownDismissed: boolean,
  notice: ViewerNotice | undefined,
): ShellNoticeView | undefined {
  if (registration.state === "refused" && !lockdownDismissed) return { kind: "lockdown" }
  return notice === undefined ? undefined : { kind: "viewer", notice }
}
