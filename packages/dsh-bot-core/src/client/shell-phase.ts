// Copied line for line from dsh-client-ui-conversation contract/snapshot.ts `conversationPhase` and skeleton/ConversationMainPanel.tsx (upstream.ts).
import type { PhaseConversation, PhaseSession } from "./dsh/conversation"

export type ShellPhase = "settling" | "hero" | "active"

function conversationPhase(
  session: PhaseSession,
  conversation: PhaseConversation,
): "blank" | "engaging" | "active" {
  const active =
    conversation.activeTargets.size > 0 ||
    (!session.blank && !session.awaitingFirstTurn) ||
    session.running
  return active ? "active" : session.promptAttempted ? "engaging" : "blank"
}

export function shellPhase(input: {
  readonly sessionId: string | undefined
  readonly session: PhaseSession | undefined
  readonly conversation: PhaseConversation | undefined
  /** The session list's `blank` for the session. */
  readonly summaryBlank: boolean | undefined
}): { readonly phase: ShellPhase; readonly hero: boolean } {
  const { sessionId, session, conversation, summaryBlank } = input
  const phase =
    session === undefined || conversation === undefined
      ? "blank"
      : conversationPhase(session, conversation)
  const openState = session?.openState
  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable: the composer renders hidden. A session the list
  // already proves blank can only land on the hero (upstream comment).
  const settling =
    sessionId !== undefined && phase === "blank" && openState === "loading" && summaryBlank !== true
  const hero =
    sessionId === undefined ||
    (phase === "blank" && (openState === "open" || summaryBlank === true))
  return { phase: settling ? "settling" : hero ? "hero" : "active", hero }
}

/** What a bot session's shell draws in place of DSH's conversation. */
export type BotShellView =
  | { readonly kind: "preparing" }
  | {
      readonly kind: "conversation"
      readonly phase: Exclude<ShellPhase, "hero">
      readonly hero: false
    }

/**
 * Not upstream: DSH's hero keeps the composer inert for a session outside a
 * Workspace, which a bot session always is, so a blank one is drawn active
 * and takes input, unless it is still being prepared.
 */
export function botShellView(
  shell: { readonly phase: ShellPhase; readonly hero: boolean },
  preparing: boolean,
): BotShellView {
  if (shell.phase !== "hero") return { kind: "conversation", phase: shell.phase, hero: false }
  return preparing ? { kind: "preparing" } : { kind: "conversation", phase: "active", hero: false }
}
