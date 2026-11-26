import { botIdOfPreset } from "../../shared/preset"

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
  isBot(botId: string): boolean
  recorded(sessionId: string): string | undefined
  agent(sessionId: string): A | undefined
}

export type SessionIdentity =
  | { readonly kind: "none" }
  | { readonly kind: "bot"; readonly botId: string }
  | { readonly kind: "unverified"; readonly reason: string }

const NONE: SessionIdentity = { kind: "none" }

const MAX_DEPTH = 32

export function botOfPresetId(
  preset: string | undefined,
  isBot: (botId: string) => boolean,
): string | undefined {
  if (preset === undefined) return undefined
  const botId = botIdOfPreset(preset)
  return botId !== undefined && isBot(botId) ? botId : undefined
}

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
