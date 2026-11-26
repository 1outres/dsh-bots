import type { BotVaultsBackend } from "../../service"
import type { VaultAccess } from "./access"
import type { VaultChecks } from "./checks"
import type { VaultStore } from "./store"
import { credentialsListAnswer } from "./texts"

export interface VaultRowsDeps<A> {
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  botOf(agent: A): string | undefined
  checks: VaultChecks
  access: Pick<VaultAccess, "credentials">
  store: Pick<VaultStore, "grants">
}

export type VaultRows = Omit<BotVaultsBackend, "register" | "list">

export function createVaultRows<A>(deps: VaultRowsDeps<A>): VaultRows {
  const refusal = (botId: string, token: string, agentId: string): string | undefined => {
    if (!deps.sealed(botId, token)) {
      return `this preset revision of bot "${botId}" was not registered by this bot-core`
    }
    const agent = deps.agent(agentId)
    if (agent === undefined || deps.botOf(agent) !== botId) {
      return `Agent "${agentId}" does not run a session of bot "${botId}"`
    }
    return undefined
  }
  return {
    async guardArguments(botId, token, request) {
      if (!deps.checks.guards(botId)) return { kind: "allow" }
      const refused = refusal(botId, token, request.agentId)
      if (refused !== undefined) return { kind: "deny", reason: refused }
      return deps.checks.toolArguments(botId, request)
    },
    async guardResult(botId, token, request) {
      if (!deps.checks.guards(botId)) return { kind: "clean" }
      const refused = refusal(botId, token, request.agentId)
      if (refused !== undefined) return { kind: "failed", reason: refused }
      return deps.checks.toolResult(botId, request)
    },
    credentialsAvailable: (botId, token, agentId) =>
      refusal(botId, token, agentId) === undefined && deps.store.grants(botId).length > 0,
    async listCredentials(botId, token, agentId, signal) {
      const refused = refusal(botId, token, agentId)
      if (refused !== undefined) throw new Error(`bot-core: ${refused}`)
      return credentialsListAnswer(await deps.access.credentials(botId, signal))
    },
  }
}
