import type { BotConnectionProvider } from "../../connector-contract"

const ID = /^[a-z][a-z0-9-]*$/

const isUrl = (value: unknown) => {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function providerProblem(provider: BotConnectionProvider): string | undefined {
  if (typeof provider !== "object" || provider === null) return "the provider is not an object"
  if (typeof provider.id !== "string" || !ID.test(provider.id)) {
    return "the provider id must be lower-case letters, digits and -, starting with a letter"
  }
  const what = `provider "${provider.id}"`
  if (typeof provider.name !== "string" || provider.name.trim() === "") return `${what} has no name`
  if (typeof provider.identify !== "function") return `${what} has no identify`
  if (
    provider.guide !== undefined &&
    !(isUrl(provider.guide) && provider.guide.startsWith("https:"))
  ) {
    return `${what}: guide is not an https URL`
  }
  const { oauth } = provider
  if (typeof oauth !== "object" || oauth === null) return `${what} has no oauth endpoints`
  for (const key of ["authorizationEndpoint", "tokenEndpoint"] as const) {
    if (!isUrl(oauth[key])) return `${what}: oauth.${key} is not an http(s) URL`
  }
  if (oauth.revocationEndpoint !== undefined && !isUrl(oauth.revocationEndpoint)) {
    return `${what}: oauth.revocationEndpoint is not an http(s) URL`
  }
  if (
    !Array.isArray(oauth.identityScopes) ||
    oauth.identityScopes.some((scope) => typeof scope !== "string" || scope.trim() === "")
  ) {
    return `${what}: oauth.identityScopes must be scope names`
  }
  const parameters = oauth.authorizationParameters ?? {}
  if (Object.values(parameters).some((value) => typeof value !== "string")) {
    return `${what}: oauth.authorizationParameters must be text`
  }
  return undefined
}

export interface ConnectionProviders {
  register(provider: BotConnectionProvider): () => void
  get(providerId: string): BotConnectionProvider | undefined
  list(): readonly BotConnectionProvider[]
  subscribe(listener: () => void): () => void
}

export function createConnectionProviders(): ConnectionProviders {
  const entries = new Map<string, BotConnectionProvider>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    register(provider) {
      const problem = providerProblem(provider)
      if (problem !== undefined) throw new Error(`bot-core: ${problem}`)
      if (entries.has(provider.id)) {
        throw new Error(`bot-core: provider "${provider.id}" is already registered`)
      }
      entries.set(provider.id, provider)
      publish()
      return () => {
        if (entries.get(provider.id) !== provider) return
        entries.delete(provider.id)
        publish()
      }
    },
    get: (providerId) => entries.get(providerId),
    list: () => [...entries.values()],
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
