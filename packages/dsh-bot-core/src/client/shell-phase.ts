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
  readonly summaryBlank: boolean | undefined
}): { readonly phase: ShellPhase; readonly hero: boolean } {
  const { sessionId, session, conversation, summaryBlank } = input
  const phase =
    session === undefined || conversation === undefined
      ? "blank"
      : conversationPhase(session, conversation)
  const openState = session?.openState
  const settling =
    sessionId !== undefined && phase === "blank" && openState === "loading" && summaryBlank !== true
  const hero =
    sessionId === undefined ||
    (phase === "blank" && (openState === "open" || summaryBlank === true))
  return { phase: settling ? "settling" : hero ? "hero" : "active", hero }
}

export type BotShellView =
  | { readonly kind: "preparing" }
  | {
      readonly kind: "conversation"
      readonly phase: Exclude<ShellPhase, "hero">
      readonly hero: false
    }

export function botShellView(
  shell: { readonly phase: ShellPhase; readonly hero: boolean },
  preparing: boolean,
): BotShellView {
  if (shell.phase !== "hero") return { kind: "conversation", phase: shell.phase, hero: false }
  return preparing ? { kind: "preparing" } : { kind: "conversation", phase: "active", hero: false }
}
