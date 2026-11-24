/**
 * Which bot a session belongs to: the one answer to "is this a bot's
 * session", used by isolation, the placement keeper and the working-directory
 * hook alike.
 *
 * Every bot session runs in the same environment workspace path, so a
 * directory tells bots apart no longer. The header's `agentPreset` alone
 * proves nothing for a subagent: DSH writes the preset the subagent selected
 * there, so a Workspace Agent delegating under `bot-X` produces a header that
 * names bot X. Hence:
 *
 * 1. A subagent (`header.parentSession` set) whose parent Agent is live takes
 *    the parent's classification and nothing else: a bot parent's child is
 *    that bot's (and locked down unless on its preset), a Workspace parent's
 *    child is no bot's whatever its header names (on a bot preset, isolation
 *    then locks it down), and an unverified parent's child stays unverified.
 * 2. A subagent whose parent is not live (a resumed child, its parent gone):
 *    the parent's identity cannot be checked. It is the bot's only when
 *    bot-core itself recorded the session as the bot's. Else, when its header
 *    names a bot's preset, it is **unverified** (fail closed: isolation locks
 *    it down, and nothing else treats it as the bot's); a header naming no
 *    bot preset makes it no bot's (on a bot preset, isolation locks it down).
 * 3. Any other session (a Main, a session from `Bot.createSession`, a fork):
 *    its header's `agentPreset` is X's preset (`bot-X`) and X is a bot of this
 *    bot-core — the header is immutable, set at creation and inherited by a
 *    fork — else bot-core recorded the session as X's (a Main created before
 *    bot presets, a fork recorded on `agent/created`).
 */
import { botIdOfPreset } from "../../shared/preset"

/** The slice of a live Agent the identity reads. */
export interface IdentityAgent {
  readonly id: string
  readonly session: {
    readonly header: {
      readonly agentPreset?: string | undefined
      readonly parentSession?: string | undefined
    }
  }
}

export interface SessionIdentityDeps<A extends IdentityAgent> {
  /** Whether `botId` is a bot of this bot-core (stored, or seen since start). */
  isBot(botId: string): boolean
  /** The bot that recorded `sessionId` as its own (registry `botOfSession`). */
  recorded(sessionId: string): string | undefined
  /** The live Agent of a session id (`agents.get`). */
  agent(sessionId: string): A | undefined
}

/** Whose session an Agent runs. */
export type SessionIdentity =
  | { readonly kind: "none" }
  | { readonly kind: "bot"; readonly botId: string }
  /** It may be a bot's session, but that cannot be verified: fail closed. */
  | { readonly kind: "unverified"; readonly reason: string }

const NONE: SessionIdentity = { kind: "none" }

/** Longest parent chain followed; deeper delegation is refused well before this. */
const MAX_DEPTH = 32

/** The bot whose preset id `preset` is, when it is a bot of this bot-core. */
export function botOfPresetId(
  preset: string | undefined,
  isBot: (botId: string) => boolean,
): string | undefined {
  if (preset === undefined) return undefined
  const botId = botIdOfPreset(preset)
  return botId !== undefined && isBot(botId) ? botId : undefined
}

/** The bot of a verified identity, or undefined (none, or unverified). */
export function botOfIdentity(identity: SessionIdentity): string | undefined {
  return identity.kind === "bot" ? identity.botId : undefined
}

export function createSessionIdentity<A extends IdentityAgent>(deps: SessionIdentityDeps<A>) {
  const bot = (botId: string): SessionIdentity => ({ kind: "bot", botId })

  const identityOf = (agent: A, depth: number): SessionIdentity => {
    const { header } = agent.session
    if (header.parentSession !== undefined) {
      if (depth >= MAX_DEPTH) {
        return {
          kind: "unverified",
          reason: "its chain of delegating Agents is too deep to verify",
        }
      }
      const parent = deps.agent(header.parentSession)
      // The live parent decides, never the child's header.
      if (parent !== undefined) return identityOf(parent, depth + 1)
      const recorded = deps.recorded(agent.id)
      if (recorded !== undefined) return bot(recorded)
      const named = botOfPresetId(header.agentPreset, deps.isBot)
      return named === undefined
        ? NONE
        : {
            kind: "unverified",
            reason: `it is a subagent naming bot "${named}"'s Agent preset whose delegating Agent is not running, so its bot cannot be verified`,
          }
    }
    const named = botOfPresetId(header.agentPreset, deps.isBot) ?? deps.recorded(agent.id)
    return named === undefined ? NONE : bot(named)
  }
  return (agent: A): SessionIdentity => identityOf(agent, 0)
}
