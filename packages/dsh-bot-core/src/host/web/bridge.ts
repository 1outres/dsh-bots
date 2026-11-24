import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"
import type { WebOutcome, WebRefusal } from "../../internal"
import type { BotWebCapability, BotWebSettings } from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"
import type { WebState } from "./state"

export interface WebBridgeDeps {
  readonly state: WebState
  /** Whether `token` belongs to a revision bot-core registered for the bot during this load. */
  sealed(botId: string, token: string): boolean
  /** The Agent whose step is asking, if the call runs inside one. */
  caller(): string | undefined
}

/**
 * What bot-core's bridge row asks of the Host for a bot's Agents. Each Agent
 * reads the settings as they were when its turn started, so a change applies
 * from its next turn and never inside a running one.
 */
export interface WebBridge {
  ready(botId: string, token: string, capability: BotWebCapability): Promise<boolean>
  search(
    botId: string,
    token: string,
    request: WebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebOutcome<WebSearchResult>>
  fetch(
    botId: string,
    token: string,
    request: WebFetchRequest,
    signal: AbortSignal,
  ): Promise<WebOutcome<WebFetchResult>>
  /** A turn of `agentId` started: it keeps the settings of now until it ends. */
  turnStarted(agentId: string): void
  turnEnded(agentId: string): void
}

const unavailable = (message: string): WebRefusal => ({ code: "WEB_PROVIDER_UNAVAILABLE", message })

export function createWebBridge(deps: WebBridgeDeps): WebBridge {
  const { state } = deps
  const turns = new Map<string, BotWebSettings>()

  const settingsOfCaller = (): BotWebSettings => {
    const agentId = deps.caller()
    return (agentId === undefined ? undefined : turns.get(agentId)) ?? state.settings()
  }

  type Resolved =
    | {
        readonly ok: true
        readonly backend: BotWebBackend
        readonly secrets: Readonly<Record<string, string>>
      }
    | { readonly ok: false; readonly refusal: WebRefusal }

  const resolve = async (
    botId: string,
    token: string,
    capability: BotWebCapability,
  ): Promise<Resolved> => {
    if (!deps.sealed(botId, token)) {
      return {
        ok: false,
        refusal: unavailable("this row is not one of the bot's preset revisions"),
      }
    }
    const settings = settingsOfCaller()
    if (!settings[capability]) {
      return { ok: false, refusal: unavailable(`web ${capability} is turned off for bots`) }
    }
    const backend = state.backend()
    if (backend === undefined || backend.id !== settings.backend) {
      return {
        ok: false,
        refusal: unavailable(`the web backend "${settings.backend}" is not registered`),
      }
    }
    if (backend[capability] === undefined) {
      return {
        ok: false,
        refusal: unavailable(`the web backend "${backend.id}" cannot ${capability}`),
      }
    }
    const vault = state.vault()
    if (vault === undefined) {
      return { ok: false, refusal: unavailable("DSH's credential store is not available") }
    }
    const secrets = await vault.read(backend.id)
    const missing = backend.secrets.filter((secret) => secrets[secret.key] === undefined)
    if (missing.length > 0) {
      return {
        ok: false,
        refusal: {
          code: "WEB_PROVIDER_CREDENTIAL_MISSING",
          message: `${missing.map((secret) => secret.label.en).join(", ")} is not set in the dsh-bots settings (Web lookup)`,
        },
      }
    }
    return { ok: true, backend, secrets }
  }

  return {
    async ready(botId, token, capability) {
      return (await resolve(botId, token, capability)).ok
    },
    async search(botId, token, request, signal) {
      const resolved = await resolve(botId, token, "search")
      if (!resolved.ok) return resolved
      const { backend, secrets } = resolved
      const result = await backend.search?.run(request, { botId, secrets, signal })
      return result === undefined
        ? { ok: false, refusal: unavailable("no search") }
        : { ok: true, result }
    },
    async fetch(botId, token, request, signal) {
      const resolved = await resolve(botId, token, "fetch")
      if (!resolved.ok) return resolved
      const { backend, secrets } = resolved
      const result = await backend.fetch?.run(request, { botId, secrets, signal })
      return result === undefined
        ? { ok: false, refusal: unavailable("no fetch") }
        : { ok: true, result }
    },
    turnStarted(agentId) {
      turns.set(agentId, state.settings())
    },
    turnEnded(agentId) {
      turns.delete(agentId)
    },
  }
}
