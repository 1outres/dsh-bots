/**
 * The only way to a login's values (docs/specs/bot-vaults.md §5, design rule
 * 59): every reveal is checked against the bot's login (its handle, kinds,
 * connectors, the provider's kinds, the target's origin or the desktop
 * switch, a passkey's relying party), recorded, and fingerprinted for the
 * leak guard before it is handed over. A refusal is recorded too. What the
 * bot reads of a failure is bot-core's own wording; the provider's message
 * goes to the owner's history only.
 */
import {
  GUARDED_KINDS,
  isCredentialHandle,
  rpIdAllowed,
  siteMatches,
  VAULT_REVEAL_KINDS,
  type VaultFieldKind,
  type VaultRevealKind,
  type VaultSecretKind,
  type VaultUseTarget,
} from "../../shared/vaults"
import {
  type BotCredential,
  type BotVaultAccess,
  type BrowserCredentialTarget,
  type CredentialTarget,
  SecretBytes,
  type VaultItemSummary,
  type VaultPasskey,
  type VaultSession,
} from "../../vault-contract"
import type { VaultAvailability } from "./availability"
import type { VaultGrantRecord } from "./domain"
import type { VaultGuard } from "./guard"
import type { VaultProviders } from "./providers"
import type { VaultSessions } from "./sessions"
import type { VaultStore } from "./store"

export interface VaultAccessDeps {
  store: Pick<VaultStore, "grant" | "grants" | "account" | "recordUse">
  providers: Pick<VaultProviders, "get">
  sessions: Pick<VaultSessions, "session">
  guard: Pick<VaultGuard, "fingerprint">
  availability: Pick<VaultAvailability, "set">
  newId(): string
  now(): number
  /** For the Host's log: never a value or an id of the provider. */
  warn(message: string): void
}

/** Which tool of which connector reaches the logins, for whom. */
export interface VaultAccessContext {
  readonly botId: string
  readonly connector: string
  readonly tool: string
  readonly sessionId?: string
  readonly signal: AbortSignal
}

/** A connector run's access, and the end of it: every value it handed out is wiped then. */
export interface VaultRun {
  readonly access: BotVaultAccess
  release(): void
}

/** A login as `credentials_list` shows it, with whether its item could be read now. */
export interface ListedCredential {
  readonly credential: BotCredential
  readonly connectors: readonly string[]
  readonly state: "available" | "missing" | "unreachable"
}

export interface VaultAccess {
  forRun(context: VaultAccessContext): VaultRun
  /** The bot's logins as it sees them (their items read now). */
  credentials(botId: string, signal: AbortSignal): Promise<readonly ListedCredential[]>
  /** The login's item now, read again (its availability follows). */
  item(grant: VaultGrantRecord, signal: AbortSignal): Promise<VaultItemSummary | undefined>
  /** Fingerprint the secrets a new or changed login may reveal (each read once). */
  fingerprintGrant(botId: string, grantId: string, signal: AbortSignal): Promise<void>
}

/** A refusal: its message is what the connector and the record say. */
export class VaultRefusal extends Error {
  override readonly name = "VaultRefusal"
}

export const NOT_A_CREDENTIAL = "not one of this bot's credentials"

const KIND_NAMES: Readonly<Record<VaultFieldKind, string>> = {
  username: "username",
  password: "password",
  otp: "one-time code",
  passkey: "passkey",
}

const targetOf = (target: CredentialTarget): VaultUseTarget =>
  target.kind === "browser"
    ? { kind: "browser", origin: target.origin }
    : { kind: "desktop", application: target.application }

const isGuarded = (kind: VaultFieldKind): kind is VaultSecretKind =>
  (GUARDED_KINDS as readonly string[]).includes(kind)

/** A failure of the provider, with what the owner may read of it. */
class ProviderFailure extends Error {
  override readonly name = "ProviderFailure"
  constructor(
    readonly label: string,
    readonly detail: string,
    readonly errorName: string,
  ) {
    super(
      `the password manager could not provide "${label}" now; your owner can see why in your Logins settings`,
    )
  }
}

export function createVaultAccess(deps: VaultAccessDeps): VaultAccess {
  const require = (botId: string, handle: unknown): VaultGrantRecord => {
    if (!isCredentialHandle(handle)) throw new VaultRefusal(NOT_A_CREDENTIAL)
    const grant = deps.store.grant(botId, handle)
    if (grant?.botId !== botId) throw new VaultRefusal(NOT_A_CREDENTIAL)
    return grant
  }
  const fromProvider = async <T>(grant: VaultGrantRecord, work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (error instanceof VaultRefusal) throw error
      const errorName = error instanceof Error ? error.name : typeof error
      throw new ProviderFailure(
        grant.label,
        error instanceof Error ? error.message : String(error),
        errorName,
      )
    }
  }
  const sessionOf = (grant: VaultGrantRecord, signal: AbortSignal): Promise<VaultSession> =>
    deps.sessions.session(grant.accountId, signal)
  const readItem = (grant: VaultGrantRecord, signal: AbortSignal) =>
    fromProvider(grant, async () => {
      const session = await sessionOf(grant, signal)
      const item = await session.item({ vaultId: grant.vaultId, itemId: grant.itemId }, signal)
      deps.availability.set(grant.botId, grant.id, item === undefined ? "missing" : "available")
      return item
    })
  const providerKinds = (grant: VaultGrantRecord): readonly VaultFieldKind[] => {
    const account = deps.store.account(grant.accountId)
    const provider = account === undefined ? undefined : deps.providers.get(account.provider)
    return provider === undefined ? [] : ["username", ...provider.kinds]
  }
  const describe = (
    grant: VaultGrantRecord,
    item: VaultItemSummary | undefined,
  ): BotCredential => ({
    handle: grant.id,
    label: grant.label,
    ...(grant.showUsername && item?.username !== undefined ? { username: item.username } : {}),
    sites: grant.sites,
    kinds: grant.kinds,
    desktop: grant.desktop,
  })
  const fieldOf = (item: VaultItemSummary, kind: VaultSecretKind) =>
    item.fields.find((field) => field.kind === kind)
  const fingerprinted = (grant: VaultGrantRecord, kind: VaultSecretKind, secret: SecretBytes) =>
    secret.use(async (bytes) => {
      await deps.guard.fingerprint(grant.botId, grant.id, kind, bytes)
      return SecretBytes.from(new Uint8Array(bytes))
    })
  const gone = (grant: VaultGrantRecord) =>
    new VaultRefusal(`the item of "${grant.label}" is gone from the password manager`)

  const reveal = async (
    grant: VaultGrantRecord,
    kind: VaultRevealKind,
    signal: AbortSignal,
  ): Promise<SecretBytes> => {
    const item = await readItem(grant, signal)
    if (item === undefined) throw gone(grant)
    if (kind === "username") {
      if (item.username === undefined) throw new VaultRefusal(`"${grant.label}" has no username`)
      return SecretBytes.from(new TextEncoder().encode(item.username))
    }
    const field = fieldOf(item, kind)
    if (field === undefined) throw new VaultRefusal(`"${grant.label}" has no ${KIND_NAMES[kind]}`)
    const secret = await fromProvider(grant, async () =>
      (await sessionOf(grant, signal)).reveal(
        { vaultId: grant.vaultId, itemId: grant.itemId, fieldId: field.id, kind },
        signal,
      ),
    )
    return isGuarded(kind) ? fingerprinted(grant, kind, secret) : secret
  }

  const passkey = async (grant: VaultGrantRecord, signal: AbortSignal): Promise<VaultPasskey> => {
    const item = await readItem(grant, signal)
    if (item === undefined) throw gone(grant)
    const field = fieldOf(item, "passkey")
    const session = await fromProvider(grant, () => sessionOf(grant, signal))
    const read = session.passkey?.bind(session)
    if (field === undefined || read === undefined) {
      throw new VaultRefusal(`"${grant.label}" has no passkey`)
    }
    const found = await fromProvider(grant, () =>
      read(
        { vaultId: grant.vaultId, itemId: grant.itemId, fieldId: field.id, kind: "passkey" },
        signal,
      ),
    )
    return { ...found, privateKey: await fingerprinted(grant, "passkey", found.privateKey) }
  }

  const checkKind = (grant: VaultGrantRecord, kind: VaultFieldKind) => {
    if (!grant.kinds.includes(kind)) {
      throw new VaultRefusal(`the owner did not allow the ${KIND_NAMES[kind]} of "${grant.label}"`)
    }
    if (!providerKinds(grant).includes(kind)) {
      throw new VaultRefusal(`the password manager of "${grant.label}" has no ${KIND_NAMES[kind]}`)
    }
  }
  const checkConnector = (grant: VaultGrantRecord, connector: string) => {
    if (!grant.connectors.includes(connector)) {
      throw new VaultRefusal(`the owner did not allow this connector to fill "${grant.label}"`)
    }
  }
  const checkTarget = (grant: VaultGrantRecord, target: CredentialTarget) => {
    if (target?.kind === "browser") {
      if (typeof target.origin !== "string" || !siteMatches(grant.sites, target.origin)) {
        throw new VaultRefusal(
          `"${grant.label}" may not be used on ${String(target.origin)}; its sites: ${grant.sites.map((site) => site.origin).join(", ") || "none"}`,
        )
      }
      return
    }
    if (target?.kind === "desktop") {
      if (!grant.desktop) {
        throw new VaultRefusal(`the owner did not allow "${grant.label}" in desktop applications`)
      }
      return
    }
    throw new VaultRefusal("unknown target")
  }

  return {
    forRun(context) {
      const handed = new Set<SecretBytes>()
      let released = false
      const record = (
        grant: VaultGrantRecord,
        kind: VaultFieldKind,
        target: CredentialTarget,
        outcome: "filled" | "refused",
        reason?: string,
      ) =>
        deps.store.recordUse({
          id: deps.newId(),
          botId: context.botId,
          grantId: grant.id,
          kind,
          connector: context.connector,
          tool: context.tool,
          ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
          target: targetOf(target),
          at: deps.now(),
          outcome,
          ...(reason === undefined ? {} : { reason }),
        })
      const guarded = async <T>(
        handle: string,
        kind: VaultFieldKind,
        target: CredentialTarget,
        work: (grant: VaultGrantRecord) => Promise<T>,
        secretsOf: (value: T) => readonly SecretBytes[],
      ): Promise<T> => {
        if (released) throw new VaultRefusal("this run of the tool has ended")
        const grant = require(context.botId, handle)
        let value: T
        try {
          checkConnector(grant, context.connector)
          checkKind(grant, kind)
          checkTarget(grant, target)
          value = await work(grant)
        } catch (error) {
          const shown =
            error instanceof VaultRefusal || error instanceof ProviderFailure
              ? error.message
              : `the password manager could not provide "${grant.label}" now`
          const owned =
            error instanceof ProviderFailure
              ? `the password manager failed: ${error.detail}`
              : shown
          if (error instanceof ProviderFailure) {
            deps.warn(
              `bot-core: a password manager failed for a login of bot "${context.botId}" (${error.errorName})`,
            )
          }
          await record(grant, kind, target, "refused", owned).catch(() => {})
          throw new VaultRefusal(shown)
        }
        const wipe = () => {
          for (const secret of secretsOf(value)) secret.wipe()
        }
        if (context.signal.aborted || released) {
          wipe()
          throw new VaultRefusal("the call was cancelled, so nothing was handed over")
        }
        try {
          await record(grant, kind, target, "filled")
        } catch {
          wipe()
          throw new VaultRefusal("bot-core could not record the use, so nothing was handed over")
        }
        for (const secret of secretsOf(value)) handed.add(secret)
        return value
      }
      const access: BotVaultAccess = {
        async describe(handle) {
          const grant = require(context.botId, handle)
          checkConnector(grant, context.connector)
          const item = await readItem(grant, context.signal).catch(() => {
            throw new VaultRefusal(NOT_A_CREDENTIAL)
          })
          if (item === undefined) throw new VaultRefusal(NOT_A_CREDENTIAL)
          return describe(grant, item)
        },
        reveal(handle, field, target) {
          if (!VAULT_REVEAL_KINDS.includes(field)) {
            return Promise.reject(new VaultRefusal("unknown field"))
          }
          return guarded(
            handle,
            field,
            target,
            (grant) => reveal(grant, field, context.signal),
            (secret) => [secret],
          )
        },
        passkey: (handle, target: BrowserCredentialTarget) =>
          guarded(
            handle,
            "passkey",
            target,
            async (grant) => {
              if (target?.kind !== "browser")
                throw new VaultRefusal("a passkey is used in a browser only")
              const found = await passkey(grant, context.signal)
              if (!rpIdAllowed(found.rpId, target.origin)) {
                found.privateKey.wipe()
                throw new VaultRefusal(
                  `the passkey of "${grant.label}" is for ${found.rpId}, not ${target.origin}`,
                )
              }
              return found
            },
            (found) => [found.privateKey],
          ),
      }
      return {
        access,
        release() {
          released = true
          for (const secret of handed) secret.wipe()
          handed.clear()
        },
      }
    },
    async credentials(botId, signal) {
      return Promise.all(
        deps.store.grants(botId).map(async (grant): Promise<ListedCredential> => {
          try {
            const item = await readItem(grant, signal)
            return {
              credential: describe(grant, item),
              connectors: grant.connectors,
              state: item === undefined ? "missing" : "available",
            }
          } catch {
            return {
              credential: describe(grant, undefined),
              connectors: grant.connectors,
              state: "unreachable",
            }
          }
        }),
      )
    },
    item: (grant, signal) => readItem(grant, signal),
    async fingerprintGrant(botId, grantId, signal) {
      const grant = require(botId, grantId)
      const kinds = providerKinds(grant)
      if (grant.kinds.includes("password") && kinds.includes("password")) {
        ;(await reveal(grant, "password", signal)).wipe()
      }
      if (grant.kinds.includes("passkey") && kinds.includes("passkey")) {
        ;(await passkey(grant, signal)).privateKey.wipe()
      }
    },
  }
}
