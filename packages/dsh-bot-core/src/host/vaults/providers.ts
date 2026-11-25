import { VAULT_SECRET_KINDS } from "../../shared/vaults"
import type { BotVaultProvider } from "../../vault-contract"

const ID = /^[a-z][a-z0-9-]*$/
const KEY = /^[a-z][a-z0-9_]*$/
const SETUP_KINDS = new Set(["secret", "text", "url"])

const isText = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { en?: unknown }).en === "string" &&
  (value as { en: string }).en.trim() !== ""

/** Why a provider cannot be registered, or undefined. */
export function vaultProviderProblem(provider: BotVaultProvider): string | undefined {
  if (typeof provider !== "object" || provider === null) return "the provider is not an object"
  if (typeof provider.id !== "string" || !ID.test(provider.id)) {
    return "the provider id must be lower-case letters, digits and -, starting with a letter"
  }
  const what = `vault provider "${provider.id}"`
  if (typeof provider.name !== "string" || provider.name.trim() === "") return `${what} has no name`
  if (typeof provider.open !== "function") return `${what} has no open`
  if (provider.guide !== undefined) {
    let https = false
    try {
      https = new URL(provider.guide).protocol === "https:"
    } catch {}
    if (!https) return `${what}: guide is not an https URL`
  }
  if (provider.development !== undefined && typeof provider.development !== "boolean") {
    return `${what}: development must be true or false`
  }
  if (!Array.isArray(provider.kinds) || provider.kinds.length === 0) {
    return `${what} hands out no kind of secret`
  }
  const kinds = new Set<string>()
  for (const kind of provider.kinds) {
    if (!VAULT_SECRET_KINDS.includes(kind) || kinds.has(kind)) {
      return `${what}: kinds must be distinct ones of ${VAULT_SECRET_KINDS.join(", ")}`
    }
    kinds.add(kind)
  }
  if (!Array.isArray(provider.setup)) return `${what}: setup must be a list`
  const keys = new Set<string>()
  for (const field of provider.setup) {
    if (typeof field?.key !== "string" || !KEY.test(field.key) || keys.has(field.key)) {
      return `${what}: setup keys must be distinct lower-case letters, digits and _`
    }
    keys.add(field.key)
    if (!isText(field.label)) return `${what}: setup field "${field.key}" has no label`
    if (!SETUP_KINDS.has(field.kind)) {
      return `${what}: setup field "${field.key}" must be secret, text or url`
    }
    if (typeof field.required !== "boolean") {
      return `${what}: setup field "${field.key}" must say whether it is required`
    }
    if (field.help !== undefined && !isText(field.help)) {
      return `${what}: setup field "${field.key}" has an empty help`
    }
  }
  const { status } = provider
  if (
    status !== undefined &&
    (typeof status.read !== "function" || typeof status.subscribe !== "function")
  ) {
    return `${what}: status needs read and subscribe`
  }
  return undefined
}

export interface VaultProviders {
  /** @throws when the provider is invalid or its id is taken. */
  register(provider: BotVaultProvider): () => void
  get(providerId: string): BotVaultProvider | undefined
  list(): readonly BotVaultProvider[]
  /** Called after a registration, an unregistration or a provider's status change. */
  subscribe(listener: () => void): () => void
  /** Called with the provider id after it was unregistered. */
  onRemoved(listener: (providerId: string) => void): () => void
}

export function createVaultProviders(): VaultProviders {
  const entries = new Map<string, { provider: BotVaultProvider; off: () => void }>()
  const listeners = new Set<() => void>()
  const removed = new Set<(providerId: string) => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    register(provider) {
      const problem = vaultProviderProblem(provider)
      if (problem !== undefined) throw new Error(`bot-core: ${problem}`)
      if (entries.has(provider.id)) {
        throw new Error(`bot-core: vault provider "${provider.id}" is already registered`)
      }
      const off = provider.status?.subscribe(publish) ?? (() => {})
      entries.set(provider.id, { provider, off })
      publish()
      return () => {
        const entry = entries.get(provider.id)
        if (entry?.provider !== provider) return
        entry.off()
        entries.delete(provider.id)
        for (const listener of [...removed]) listener(provider.id)
        publish()
      }
    },
    get: (providerId) => entries.get(providerId)?.provider,
    list: () => [...entries.values()].map((entry) => entry.provider),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onRemoved(listener) {
      removed.add(listener)
      return () => {
        removed.delete(listener)
      }
    },
  }
}
