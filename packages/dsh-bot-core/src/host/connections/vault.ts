/**
 * Secrets of connections, one DSH credential record each, read by bot-core
 * alone and never sent to the browser or a bot's environment: an account's
 * refresh token (`bot-core/connection-<id>`) and a provider's OAuth client
 * secret (`bot-core/oauth-client-<provider>`).
 */

/** The slice of DSH's `credentials` service the vault uses (dsh-credentials `CredentialProvider`). */
export interface ConnectionCredentialRecords {
  readRecord(
    key: string,
  ): Promise<{ readonly kind: string; readonly payload?: unknown } | undefined>
  modifyRecord(
    key: string,
    mutate: () => Promise<{ kind: "grant"; payload: object } | undefined>,
  ): Promise<unknown>
  deleteRecord(key: string): Promise<unknown>
}

/** What an account's record keeps. */
export interface ConnectionGrantSecret {
  readonly version: 1
  readonly refreshToken: string
  readonly scopes: readonly string[]
  readonly subject: string
  readonly email?: string
}

interface ClientSecretPayload {
  readonly version: 1
  readonly clientSecret: string
}

export interface ConnectionVault {
  /** @throws when the record is missing or not bot-core's. */
  grant(connectionId: string): Promise<ConnectionGrantSecret>
  writeGrant(connectionId: string, grant: ConnectionGrantSecret): Promise<void>
  removeGrant(connectionId: string): Promise<void>
  clientSecret(provider: string): Promise<string | undefined>
  writeClientSecret(provider: string, secret: string | undefined): Promise<void>
}

const SCOPE = "bot-core"
const SEGMENT = /^[a-z][a-z0-9-]*$/

function keyOf(id: string): string {
  if (!SEGMENT.test(id)) throw new Error(`no credential key can be named "${id}"`)
  return `${SCOPE}/${id}`
}

export const connectionKey = (connectionId: string) => keyOf(`connection-${connectionId}`)
export const clientKey = (provider: string) => keyOf(`oauth-client-${provider}`)

function grantOf(key: string, record: { readonly kind: string; readonly payload?: unknown }) {
  const payload = record.payload as Partial<ConnectionGrantSecret> | undefined
  if (
    record.kind !== "grant" ||
    payload?.version !== 1 ||
    typeof payload.refreshToken !== "string" ||
    payload.refreshToken === "" ||
    typeof payload.subject !== "string" ||
    !Array.isArray(payload.scopes) ||
    payload.scopes.some((scope) => typeof scope !== "string")
  ) {
    throw new Error(`the credential record "${key}" is not one bot-core wrote`)
  }
  return payload as ConnectionGrantSecret
}

export function createConnectionVault(records: ConnectionCredentialRecords): ConnectionVault {
  return {
    async grant(connectionId) {
      const key = connectionKey(connectionId)
      const record = await records.readRecord(key)
      if (record === undefined) throw new Error("its stored credentials are missing")
      return grantOf(key, record)
    },
    async writeGrant(connectionId, grant) {
      await records.modifyRecord(connectionKey(connectionId), async () => ({
        kind: "grant",
        payload: { ...grant, scopes: [...grant.scopes] },
      }))
    },
    async removeGrant(connectionId) {
      await records.deleteRecord(connectionKey(connectionId))
    },
    async clientSecret(provider) {
      const key = clientKey(provider)
      const record = await records.readRecord(key)
      if (record === undefined) return undefined
      const payload = record.payload as Partial<ClientSecretPayload> | undefined
      if (
        record.kind !== "grant" ||
        payload?.version !== 1 ||
        typeof payload.clientSecret !== "string"
      ) {
        throw new Error(`the credential record "${key}" is not one bot-core wrote`)
      }
      return payload.clientSecret
    },
    async writeClientSecret(provider, secret) {
      const key = clientKey(provider)
      if (secret === undefined) {
        await records.deleteRecord(key)
        return
      }
      const payload: ClientSecretPayload = { version: 1, clientSecret: secret }
      await records.modifyRecord(key, async () => ({ kind: "grant", payload }))
    },
  }
}
