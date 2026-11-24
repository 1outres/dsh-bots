import type { BotConnectionProvider, ConnectionAccount } from "@1outres/dsh-bot-core"
import type { GoogleEndpoints } from "./endpoints"
import type { HttpFetch } from "./google"
import { IDENTITY_SCOPES } from "./scopes"

export const GOOGLE_PROVIDER = "google"

/** Google as a provider of connections: a Web application OAuth client with offline access. */
export function googleProvider(
  endpoints: GoogleEndpoints,
  fetch: HttpFetch,
): BotConnectionProvider {
  return {
    id: GOOGLE_PROVIDER,
    name: "Google",
    guide: "https://github.com/1outres/dsh-bots/blob/main/docs/google-connector-setup.md",
    ...(endpoints.development ? { development: true } : {}),
    oauth: {
      authorizationEndpoint: endpoints.authorization,
      tokenEndpoint: endpoints.token,
      revocationEndpoint: endpoints.revocation,
      identityScopes: [...IDENTITY_SCOPES],
      authorizationParameters: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    },
    async identify(accessToken, signal): Promise<ConnectionAccount> {
      const response = await fetch(endpoints.userinfo, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal,
      })
      if (response.status !== 200) throw new Error(`Google's userinfo answered ${response.status}`)
      const body = (await response.json()) as {
        sub?: unknown
        email?: unknown
        name?: unknown
        email_verified?: unknown
      }
      if (typeof body.sub !== "string" || body.sub === "")
        throw new Error("Google's userinfo named no account")
      if (typeof body.email === "string" && body.email_verified === false) {
        throw new Error("the account's email address is not verified")
      }
      return {
        subject: body.sub,
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.name === "string" && body.name !== "" ? { displayName: body.name } : {}),
      }
    },
  }
}
