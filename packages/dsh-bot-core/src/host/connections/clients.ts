import type { OAuthClientChange, OAuthClientView } from "../../shared/connections"
import type { ClientCredentials } from "./oauth"
import type { ConnectionStore } from "./store"
import type { ConnectionVault } from "./vault"

export interface OAuthClientsDeps {
  store: Pick<ConnectionStore, "clientId" | "setClientId">
  vault: Pick<ConnectionVault, "clientSecret" | "writeClientSecret">
  warn(message: string): void
}

/** The providers' OAuth clients: the id in bot-core's storage, the secret in DSH's credential store. */
export interface OAuthClients {
  /** Both halves, when both are set. */
  credentials(provider: string): Promise<ClientCredentials | undefined>
  /** What the browser sees (whether the secret is set, from what bot-core last read). */
  view(provider: string): OAuthClientView
  /** Read whether the provider's secret is set (a provider that just registered). */
  load(provider: string): Promise<void>
  /** @throws for a malformed change. */
  configure(provider: string, change: unknown): Promise<void>
  subscribe(listener: () => void): () => void
}

const CLIENT_ID = /^[\x21-\x7e]{1,512}$/
const MAX_SECRET = 512

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function parseChange(input: unknown): OAuthClientChange {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("the change must be an object")
  }
  const { clientId, clientSecret, ...rest } = input as Record<string, unknown>
  if (Object.keys(rest).length > 0)
    throw new Error(`"${Object.keys(rest)[0]}" is not part of the change`)
  if (typeof clientId !== "string") throw new Error("clientId must be text")
  const id = clientId.trim()
  if (id !== "" && !CLIENT_ID.test(id))
    throw new Error("clientId must be printable characters without spaces")
  const secret = clientSecret as { readonly op?: unknown; readonly value?: unknown } | undefined
  switch (secret?.op) {
    case "keep":
    case "clear":
      return { clientId: id, clientSecret: { op: secret.op } }
    case "set": {
      if (typeof secret.value !== "string") throw new Error("the secret must be text")
      const value = secret.value.trim()
      if (value === "" || value.length > MAX_SECRET || /\s/.test(value)) {
        throw new Error(`the secret must be 1 to ${MAX_SECRET} characters without spaces`)
      }
      return { clientId: id, clientSecret: { op: "set", value } }
    }
    default:
      throw new Error("clientSecret must be keep, set or clear")
  }
}

export function createOAuthClients(deps: OAuthClientsDeps): OAuthClients {
  const secretSet = new Map<string, boolean>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    async credentials(provider) {
      const clientId = deps.store.clientId(provider)
      const clientSecret = await deps.vault.clientSecret(provider)
      return clientId === undefined || clientSecret === undefined
        ? undefined
        : { clientId, clientSecret }
    },
    view(provider) {
      const clientId = deps.store.clientId(provider)
      const secret = secretSet.get(provider) === true
      return {
        ...(clientId === undefined ? {} : { clientId }),
        secretSet: secret,
        configured: clientId !== undefined && secret,
      }
    },
    async load(provider) {
      try {
        secretSet.set(provider, (await deps.vault.clientSecret(provider)) !== undefined)
      } catch (error) {
        secretSet.set(provider, false)
        deps.warn(
          `bot-core: could not read the OAuth client secret of "${provider}": ${messageOf(error)}`,
        )
      }
      changed()
    },
    async configure(provider, input) {
      const change = parseChange(input)
      if (change.clientSecret.op === "set") {
        await deps.vault.writeClientSecret(provider, change.clientSecret.value)
        secretSet.set(provider, true)
      } else if (change.clientSecret.op === "clear") {
        await deps.vault.writeClientSecret(provider, undefined)
        secretSet.set(provider, false)
      }
      await deps.store.setClientId(provider, change.clientId === "" ? undefined : change.clientId)
      changed()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
