import {
  type BotVaultProvider,
  SecretBytes,
  type VaultSession,
  type VaultSetup,
} from "../../vault-contract"
import type { VaultProviders } from "./providers"
import type { VaultRecords } from "./records"
import type { VaultStore } from "./store"

export interface VaultSessionsDeps {
  store: Pick<VaultStore, "account" | "setAccountStatus">
  providers: Pick<VaultProviders, "get" | "onRemoved">
  records: Pick<VaultRecords, "setup">
  warn(message: string): void
}

/** The provider sessions of connected accounts: one per account, opened when first needed. */
export interface VaultSessions {
  /** @throws when the account or its provider is gone, or it cannot connect (its status says why). */
  session(accountId: string, signal: AbortSignal): Promise<VaultSession>
  /** Keep a session opened for a new account. */
  adopt(accountId: string, session: VaultSession): void
  /** Close the account's session (removed, its provider gone). */
  close(accountId: string): Promise<void>
  dispose(): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A provider's setup from stored values: secret fields as bytes the
 * provider then owns, the others as text.
 */
export function vaultSetupOf(
  provider: BotVaultProvider,
  values: Readonly<Record<string, string>>,
): VaultSetup {
  const text: Record<string, string> = {}
  const secrets: Record<string, SecretBytes> = {}
  const encoder = new TextEncoder()
  for (const field of provider.setup) {
    const value = values[field.key]
    if (value === undefined) continue
    if (field.kind === "secret") secrets[field.key] = SecretBytes.from(encoder.encode(value))
    else text[field.key] = value
  }
  return { text, secrets }
}

/** Wipe the secrets of a setup the provider did not take (its `open` failed). */
export function wipeSetup(setup: VaultSetup): void {
  for (const secret of Object.values(setup.secrets)) secret.wipe()
}

export function createVaultSessions(deps: VaultSessionsDeps): VaultSessions {
  const open = new Map<string, { provider: string; session: Promise<VaultSession> }>()
  /** Bumped when an account's session is closed: a connect that started before it is thrown away. */
  const generations = new Map<string, number>()
  const closeEntry = async (accountId: string) => {
    generations.set(accountId, (generations.get(accountId) ?? 0) + 1)
    const entry = open.get(accountId)
    if (entry === undefined) return
    open.delete(accountId)
    try {
      await (await entry.session).close()
    } catch (error) {
      deps.warn(`bot-core: a password manager session did not close: ${messageOf(error)}`)
    }
  }
  const offRemoved = deps.providers.onRemoved((providerId) => {
    for (const [accountId, entry] of [...open]) {
      if (entry.provider === providerId) void closeEntry(accountId)
    }
  })
  const connect = async (accountId: string, signal: AbortSignal): Promise<VaultSession> => {
    const account = deps.store.account(accountId)
    if (account === undefined) throw new Error("no such password manager account")
    const provider = deps.providers.get(account.provider)
    if (provider === undefined) {
      throw new Error(`the password manager "${account.provider}" is not installed`)
    }
    const generation = generations.get(accountId) ?? 0
    const setup = vaultSetupOf(provider, await deps.records.setup(accountId))
    let session: VaultSession
    try {
      session = await provider.open(setup, signal)
    } catch (error) {
      wipeSetup(setup)
      await deps.store.setAccountStatus(accountId, "error", messageOf(error))
      throw new Error(`the account "${account.label}" cannot connect`)
    }
    if (
      (generations.get(accountId) ?? 0) !== generation ||
      deps.store.account(accountId) === undefined
    ) {
      await session.close().catch(() => {})
      throw new Error(`the account "${account.label}" was closed while it connected`)
    }
    await deps.store.setAccountStatus(accountId, "active")
    return session
  }
  return {
    session(accountId, signal) {
      const existing = open.get(accountId)
      if (existing !== undefined) return existing.session
      const account = deps.store.account(accountId)
      if (account === undefined)
        return Promise.reject(new Error("no such password manager account"))
      const session = connect(accountId, signal)
      const entry = { provider: account.provider, session }
      open.set(accountId, entry)
      session.catch(() => {
        if (open.get(accountId) === entry) open.delete(accountId)
      })
      return session
    },
    adopt(accountId, session) {
      const account = deps.store.account(accountId)
      if (account === undefined) throw new Error("no such password manager account")
      void closeEntry(accountId)
      open.set(accountId, { provider: account.provider, session: Promise.resolve(session) })
    },
    close: closeEntry,
    async dispose() {
      offRemoved()
      await Promise.all([...open.keys()].map(closeEntry))
    },
  }
}
