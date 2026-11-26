import { z } from "zod"
import type { BotConnectionOAuth } from "../../connector-contract"

export type OAuthFetch = (
  url: string,
  init: {
    readonly method: "POST"
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    readonly signal: AbortSignal
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>

export class OAuthError extends Error {
  override readonly name = "OAuthError"
  constructor(
    readonly code: string,
    readonly status: number,
    readonly description?: string,
  ) {
    super(`the provider refused: ${code}${description === undefined ? "" : ` (${description})`}`)
  }
}

export interface OAuthTokens {
  readonly accessToken: string
  readonly expiresIn: number
  readonly refreshToken?: string
  readonly scopes?: readonly string[]
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

const errorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
})

const DEFAULT_EXPIRES_IN = 3600

export interface AuthorizationRequest {
  readonly clientId: string
  readonly redirectUri: string
  readonly scopes: readonly string[]
  readonly state: string
  readonly codeChallenge: string
  readonly loginHint?: string
}

export function authorizationUrl(oauth: BotConnectionOAuth, request: AuthorizationRequest): string {
  const url = new URL(oauth.authorizationEndpoint)
  const parameters: Record<string, string> = {
    ...oauth.authorizationParameters,
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    ...(request.loginHint === undefined ? {} : { login_hint: request.loginHint }),
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  return url.href
}

async function post(
  fetch: OAuthFetch,
  url: string,
  form: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    signal,
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text === "" ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  return { status: response.status, body }
}

function tokensOf(status: number, body: unknown): OAuthTokens {
  if (status < 200 || status >= 300) {
    const error = errorSchema.safeParse(body)
    throw error.success
      ? new OAuthError(error.data.error, status, error.data.error_description)
      : new OAuthError("http_error", status, `status ${status}`)
  }
  const parsed = tokenSchema.safeParse(body)
  if (!parsed.success) throw new OAuthError("invalid_response", status, "not a token response")
  const { access_token, expires_in, refresh_token, scope } = parsed.data
  return {
    accessToken: access_token,
    expiresIn: expires_in ?? DEFAULT_EXPIRES_IN,
    ...(refresh_token === undefined ? {} : { refreshToken: refresh_token }),
    ...(scope === undefined ? {} : { scopes: scope.split(/\s+/).filter((item) => item !== "") }),
  }
}

export interface ClientCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

export async function exchangeCode(
  fetch: OAuthFetch,
  tokenEndpoint: string,
  client: ClientCredentials,
  grant: { readonly code: string; readonly codeVerifier: string; readonly redirectUri: string },
  signal: AbortSignal,
): Promise<OAuthTokens> {
  const { status, body } = await post(
    fetch,
    tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: grant.code,
      code_verifier: grant.codeVerifier,
      redirect_uri: grant.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    },
    signal,
  )
  return tokensOf(status, body)
}

export async function refreshAccess(
  fetch: OAuthFetch,
  tokenEndpoint: string,
  client: ClientCredentials,
  refreshToken: string,
  signal: AbortSignal,
): Promise<OAuthTokens> {
  const { status, body } = await post(
    fetch,
    tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    },
    signal,
  )
  return tokensOf(status, body)
}

export async function revokeToken(
  fetch: OAuthFetch,
  revocationEndpoint: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const { status, body } = await post(fetch, revocationEndpoint, { token }, signal)
  if (status >= 200 && status < 300) return
  const error = errorSchema.safeParse(body)
  throw error.success
    ? new OAuthError(error.data.error, status, error.data.error_description)
    : new OAuthError("http_error", status, `status ${status}`)
}
