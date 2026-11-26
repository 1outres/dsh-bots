import type { BotConnectionProvider } from "../../connector-contract"
import {
  CONNECTION_CALLBACK_PATH,
  type ConnectionAttemptState,
  type ConnectionAttemptView,
  type ConnectionAuthorization,
  type ConnectionAuthorizeRequest,
  connectionLabelProblem,
} from "../../shared/connections"
import type { ConnectionRecord } from "./domain"
import {
  authorizationUrl,
  type ClientCredentials,
  exchangeCode,
  type OAuthFetch,
  type OAuthTokens,
} from "./oauth"
import type { ConnectionProviders } from "./providers"
import type { ConnectionServices } from "./services"
import type { ConnectionStore } from "./store"
import type { ConnectionTokens } from "./tokens"
import type { ConnectionVault } from "./vault"

export interface ConnectionSignInDeps {
  providers: Pick<ConnectionProviders, "get">
  services: ConnectionServices
  store: Pick<ConnectionStore, "get" | "byAccount" | "put" | "assign">
  vault: Pick<ConnectionVault, "writeGrant">
  tokens: Pick<ConnectionTokens, "remember">
  client(provider: string): Promise<ClientCredentials | undefined>
  exists(botId: string): boolean
  fetch: OAuthFetch
  secret(): string
  challenge(verifier: string): string
  newConnectionId(): string
  newAttemptId(): string
  now(): number
  later(ms: number, work: () => void): () => void
  deadline(ms: number): AbortSignal
}

export type SignInOutcome =
  | { readonly ok: true; readonly provider: string; readonly connection: ConnectionRecord }
  | { readonly ok: false; readonly status: number; readonly reason: string }

export interface ConnectionSignIn {
  start(request: unknown): Promise<ConnectionAuthorization>
  callback(query: URLSearchParams): Promise<SignInOutcome>
  attempts(): readonly ConnectionAttemptView[]
  subscribe(listener: () => void): () => void
  dispose(): void
}

const ATTEMPT_TTL_MS = 10 * 60_000
const ENDED_KEPT_MS = 10 * 60_000
const MAX_ATTEMPTS = 20
const EXCHANGE_TIMEOUT_MS = 30_000

interface Attempt {
  view: ConnectionAttemptView
  readonly state: string
  readonly verifier: string
  readonly redirectUri: string
  readonly scopes: readonly string[]
  readonly label?: string
  cancel: () => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function originOf(input: unknown): string {
  if (typeof input !== "string") throw new Error("origin must be the Web UI's origin")
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("origin is not a URL")
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== input) {
    throw new Error("origin must be an http(s) origin without a path")
  }
  return url.origin
}

function stringList(input: unknown, what: string): readonly string[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.some((item) => typeof item !== "string")
  ) {
    throw new Error(`${what} must list at least one connector`)
  }
  return [...new Set(input as string[])]
}

export function createConnectionSignIn(deps: ConnectionSignInDeps): ConnectionSignIn {
  const attempts = new Map<string, Attempt>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }

  const settle = (attempt: Attempt, state: ConnectionAttemptState) => {
    attempt.cancel()
    attempt.view = { ...attempt.view, state }
    attempt.cancel = deps.later(ENDED_KEPT_MS, () => {
      attempts.delete(attempt.view.id)
      changed()
    })
    changed()
  }

  const parse = (input: unknown) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("the request must be an object")
    }
    const request = input as Partial<Record<keyof ConnectionAuthorizeRequest, unknown>>
    const known = new Set(["provider", "services", "label", "botId", "connectionId", "origin"])
    for (const key of Object.keys(request)) {
      if (!known.has(key)) throw new Error(`"${key}" is not part of a sign-in request`)
    }
    const provider =
      typeof request.provider === "string" ? deps.providers.get(request.provider) : undefined
    if (provider === undefined) throw new Error("the provider is not registered")
    const offered = new Set(deps.services.of(provider.id).map((service) => service.connectorId))
    const services = stringList(request.services, "services")
    for (const service of services) {
      if (!offered.has(service))
        throw new Error(`"${service}" is not a connector of ${provider.name}`)
    }
    let label: string | undefined
    if (request.label !== undefined) {
      if (typeof request.label !== "string") throw new Error("label must be text")
      const problem = connectionLabelProblem(request.label)
      if (problem !== undefined) throw new Error(problem)
      label = request.label.trim()
    }
    let botId: string | undefined
    if (request.botId !== undefined) {
      if (typeof request.botId !== "string" || !deps.exists(request.botId)) {
        throw new Error("the bot does not exist")
      }
      botId = request.botId
    }
    let existing: ConnectionRecord | undefined
    if (request.connectionId !== undefined) {
      existing =
        typeof request.connectionId === "string" ? deps.store.get(request.connectionId) : undefined
      if (existing?.provider !== provider.id) throw new Error("no such connection of this provider")
    }
    return { provider, services, label, botId, existing, origin: originOf(request.origin) }
  }

  const finish = async (
    attempt: Attempt,
    provider: BotConnectionProvider,
    tokens: OAuthTokens,
  ): Promise<ConnectionRecord> => {
    const refreshToken = tokens.refreshToken
    if (refreshToken === undefined) {
      throw new Error(
        `${provider.name} returned no refresh token; remove DeepSeek Harness's access in the account's settings and sign in again`,
      )
    }
    const granted = tokens.scopes ?? attempt.scopes
    const services = deps.services
      .of(provider.id)
      .filter((service) => service.scopes.every((scope) => granted.includes(scope)))
      .map((service) => service.connectorId)
    const asked = attempt.view.services
    if (!asked.some((service) => services.includes(service))) {
      throw new Error("the access the connectors need was not granted on the consent screen")
    }
    const account = await provider.identify(tokens.accessToken, deps.deadline(EXCHANGE_TIMEOUT_MS))
    const pinned =
      attempt.view.connectionId === undefined
        ? undefined
        : deps.store.get(attempt.view.connectionId)
    if (attempt.view.connectionId !== undefined) {
      if (pinned === undefined) throw new Error("the connection was removed meanwhile")
      if (pinned.account.subject !== account.subject) {
        throw new Error(
          `you signed in as ${account.email ?? account.subject}, but this connection is ${pinned.account.email ?? pinned.account.subject}`,
        )
      }
    }
    const previous = pinned ?? deps.store.byAccount(provider.id, account.subject)
    const id = previous?.id ?? deps.newConnectionId()
    const now = deps.now()
    await deps.vault.writeGrant(id, {
      version: 1,
      refreshToken,
      scopes: granted,
      subject: account.subject,
      ...(account.email === undefined ? {} : { email: account.email }),
    })
    const record: ConnectionRecord = {
      id,
      provider: provider.id,
      services,
      label: attempt.label ?? previous?.label ?? account.email ?? account.subject,
      account,
      grantedScopes: [...granted],
      status: "active",
      issuer: provider.oauth.tokenEndpoint,
      createdAt: previous?.createdAt ?? now,
      authorizedAt: now,
    }
    await deps.store.put(record)
    deps.tokens.remember(id, tokens)
    if (attempt.view.botId !== undefined && deps.exists(attempt.view.botId)) {
      await deps.store.assign(attempt.view.botId, id, true)
    }
    return record
  }

  return {
    async start(input) {
      const request = parse(input)
      const { provider } = request
      const client = await deps.client(provider.id)
      if (client === undefined) {
        throw new Error(`set up the ${provider.name} OAuth client in the dsh-bots settings first`)
      }
      const services = [...new Set([...(request.existing?.services ?? []), ...request.services])]
      const scopes = [
        ...new Set([
          ...provider.oauth.identityScopes,
          ...deps.services
            .of(provider.id)
            .filter((service) => services.includes(service.connectorId))
            .flatMap((service) => service.scopes),
        ]),
      ]
      const state = deps.secret()
      const verifier = deps.secret()
      const redirectUri = `${request.origin}${CONNECTION_CALLBACK_PATH}`
      const now = deps.now()
      const id = deps.newAttemptId()
      const attempt: Attempt = {
        view: {
          id,
          provider: provider.id,
          services,
          ...(request.existing === undefined ? {} : { connectionId: request.existing.id }),
          ...(request.botId === undefined ? {} : { botId: request.botId }),
          startedAt: now,
          expiresAt: now + ATTEMPT_TTL_MS,
          state: { kind: "waiting" },
        },
        state,
        verifier,
        redirectUri,
        scopes,
        ...(request.label === undefined ? {} : { label: request.label }),
        cancel: () => {},
      }
      attempt.cancel = deps.later(ATTEMPT_TTL_MS, () => {
        if (attempt.view.state.kind === "waiting") {
          settle(attempt, { kind: "failed", reason: "the sign-in expired", at: deps.now() })
        }
      })
      attempts.set(id, attempt)
      const ordered = [...attempts.values()].sort((a, b) => a.view.startedAt - b.view.startedAt)
      for (const old of ordered.slice(0, Math.max(0, ordered.length - MAX_ATTEMPTS))) {
        old.cancel()
        attempts.delete(old.view.id)
      }
      changed()
      const email = request.existing?.account.email
      return {
        attemptId: id,
        url: authorizationUrl(provider.oauth, {
          clientId: client.clientId,
          redirectUri,
          scopes,
          state,
          codeChallenge: deps.challenge(verifier),
          ...(email === undefined ? {} : { loginHint: email }),
        }),
        redirectUri,
        expiresAt: attempt.view.expiresAt,
      }
    },
    async callback(query) {
      const one = (name: string) => {
        const values = query.getAll(name)
        return values.length === 1 ? values[0] : undefined
      }
      const state = one("state")
      const attempt =
        state === undefined
          ? undefined
          : [...attempts.values()].find(
              (candidate) => candidate.state === state && candidate.view.state.kind === "waiting",
            )
      if (attempt === undefined) {
        return {
          ok: false,
          status: 400,
          reason: "This sign-in is not known or has expired. Start it again from DeepSeek Harness.",
        }
      }
      const fail = (reason: string, status: number): SignInOutcome => {
        settle(attempt, { kind: "failed", reason, at: deps.now() })
        return { ok: false, status, reason }
      }
      const provider = deps.providers.get(attempt.view.provider)
      if (provider === undefined) return fail("the provider is not registered now", 503)
      const error = one("error")
      if (error !== undefined) {
        const description = one("error_description")
        return fail(
          `${provider.name} did not grant access: ${error}${description === undefined ? "" : ` (${description})`}`,
          400,
        )
      }
      const code = one("code")
      if (code === undefined || code === "") return fail("the provider sent no code", 400)
      attempt.view = { ...attempt.view, state: { kind: "exchanging" } }
      changed()
      try {
        const client = await deps.client(provider.id)
        if (client === undefined)
          return fail(`the ${provider.name} OAuth client is not set up`, 503)
        const tokens = await exchangeCode(
          deps.fetch,
          provider.oauth.tokenEndpoint,
          client,
          { code, codeVerifier: attempt.verifier, redirectUri: attempt.redirectUri },
          deps.deadline(EXCHANGE_TIMEOUT_MS),
        )
        const connection = await finish(attempt, provider, tokens)
        settle(attempt, { kind: "connected", connectionId: connection.id, at: deps.now() })
        return { ok: true, provider: provider.name, connection }
      } catch (cause) {
        return fail(messageOf(cause), 502)
      }
    },
    attempts: () =>
      [...attempts.values()]
        .map((attempt) => attempt.view)
        .sort((a, b) => b.startedAt - a.startedAt),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const attempt of attempts.values()) attempt.cancel()
      attempts.clear()
      listeners.clear()
    },
  }
}
