import type { BotTable } from "../registry"
import {
  type VaultAccountRecord,
  type VaultFingerprintRecord,
  type VaultGrantRecord,
  type VaultIncidentRecord,
  type VaultUseRecord,
  vaultFingerprintKey,
  vaultGrantKey,
} from "./domain"

/** Uses kept per bot, and for how long. */
export const MAX_USES_PER_BOT = 500
export const USE_RETENTION_MS = 90 * 24 * 60 * 60_000
/** How long a removed login's fingerprints are still looked for. */
export const REVOKED_PRINT_RETENTION_MS = 30 * 24 * 60 * 60_000
/**
 * Acknowledged incidents kept per bot, and for how long. Unacknowledged ones
 * stay; a repeat of one (same login, kind, source and outcome) is counted on
 * it, so there are at most a few per login.
 */
export const MAX_INCIDENTS_PER_BOT = 500
export const INCIDENT_RETENTION_MS = 90 * 24 * 60 * 60_000

export interface VaultStoreDeps {
  vaultAccounts: BotTable<VaultAccountRecord>
  vaultGrants: BotTable<VaultGrantRecord>
  vaultUses: BotTable<VaultUseRecord>
  vaultFingerprints: BotTable<VaultFingerprintRecord>
  vaultIncidents: BotTable<VaultIncidentRecord>
  now(): number
}

/**
 * The vaults' records: the only writer of VAULTS_DOMAIN (design rule 58).
 * Reads come from memory; writes never interleave, and listeners hear of
 * each once stored.
 */
export interface VaultStore {
  account(accountId: string): VaultAccountRecord | undefined
  /** Oldest first. */
  accounts(): readonly VaultAccountRecord[]
  putAccount(record: VaultAccountRecord): Promise<void>
  setAccountStatus(
    accountId: string,
    status: VaultAccountRecord["status"],
    reason?: string,
  ): Promise<void>
  renameAccount(accountId: string, label: string): Promise<VaultAccountRecord>
  /** Forget the account and its logins (their fingerprints stay a while); resolves to the logins removed. */
  removeAccount(accountId: string): Promise<readonly VaultGrantRecord[]>
  grant(botId: string, grantId: string): VaultGrantRecord | undefined
  /** The bot's logins, oldest first. */
  grants(botId: string): readonly VaultGrantRecord[]
  grantsOfAccount(accountId: string): readonly VaultGrantRecord[]
  putGrant(record: VaultGrantRecord): Promise<void>
  /** Forget the login; its fingerprints stay {@link REVOKED_PRINT_RETENTION_MS}. */
  removeGrant(botId: string, grantId: string): Promise<void>
  recordUse(record: VaultUseRecord): Promise<void>
  /** Newest first. */
  uses(botId: string): readonly VaultUseRecord[]
  fingerprint(botId: string, grantId: string, kind: string): VaultFingerprintRecord | undefined
  /** The bot's fingerprints, removed logins' included. */
  fingerprints(botId: string): readonly VaultFingerprintRecord[]
  /** Store the fingerprints of a login's secret (ignored once the login is gone). */
  putFingerprint(record: VaultFingerprintRecord): Promise<void>
  /** Store an incident, or count it as a repeat of an unacknowledged one; resolves to the stored incident. */
  recordIncident(record: VaultIncidentRecord): Promise<VaultIncidentRecord>
  /** Newest first. */
  incidents(botId: string): readonly VaultIncidentRecord[]
  /** @throws when the bot has no such incident. */
  acknowledge(botId: string, incidentId: string): Promise<VaultIncidentRecord>
  /** Unacknowledged incidents per bot. */
  openIncidents(): Readonly<Record<string, number>>
  /** Forget every record of bots `keep` refuses. */
  purgeBots(keep: (botId: string) => boolean): Promise<void>
  /** Called with the bot a change concerns, or undefined for accounts. */
  subscribe(listener: (botId: string | undefined) => void): () => void
}

const values = <V>(table: BotTable<V>) => [...table.entries()].map(([, value]) => value)

export function createVaultStore(deps: VaultStoreDeps): VaultStore {
  const listeners = new Set<(botId: string | undefined) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const write = async <T>(botIds: readonly (string | undefined)[], work: () => Promise<T>) => {
    const result = await serial(work)
    for (const botId of new Set(botIds)) {
      for (const listener of [...listeners]) listener(botId)
    }
    return result
  }
  const requireAccount = (accountId: string) => {
    const record = deps.vaultAccounts.get(accountId)
    if (record === undefined) throw new Error("no such password manager account")
    return record
  }
  const grantsWhere = (keep: (record: VaultGrantRecord) => boolean) =>
    values(deps.vaultGrants)
      .filter(keep)
      .sort((a, b) => a.grantedAt - b.grantedAt)
  const printKey = (record: VaultFingerprintRecord) =>
    vaultFingerprintKey(record.botId, record.grantId, record.kind)
  const forgetGrant = async (record: VaultGrantRecord) => {
    for (const print of values(deps.vaultFingerprints)) {
      if (
        print.botId === record.botId &&
        print.grantId === record.id &&
        print.revokedAt === undefined
      ) {
        await deps.vaultFingerprints.put(printKey(print), {
          ...print,
          label: record.label,
          revokedAt: deps.now(),
        })
      }
    }
    await deps.vaultGrants.delete(vaultGrantKey(record.botId, record.id))
  }
  const pruneFingerprints = async () => {
    const oldest = deps.now() - REVOKED_PRINT_RETENTION_MS
    for (const print of values(deps.vaultFingerprints)) {
      if (print.revokedAt !== undefined && print.revokedAt < oldest) {
        await deps.vaultFingerprints.delete(printKey(print))
      }
    }
  }
  const newestFirst = <T extends { readonly at: number }>(records: readonly T[]) =>
    [...records].sort((a, b) => b.at - a.at)

  return {
    account: (accountId) => deps.vaultAccounts.get(accountId),
    accounts: () => values(deps.vaultAccounts).sort((a, b) => a.createdAt - b.createdAt),
    putAccount: (record) => write([undefined], () => deps.vaultAccounts.put(record.id, record)),
    setAccountStatus(accountId, status, reason) {
      return write([undefined], async () => {
        const record = deps.vaultAccounts.get(accountId)
        if (record === undefined) return
        if (record.status === status && record.statusReason === reason) return
        const { statusReason: _, ...rest } = record
        await deps.vaultAccounts.put(accountId, {
          ...rest,
          status,
          ...(reason === undefined ? {} : { statusReason: reason }),
        })
      })
    },
    renameAccount(accountId, label) {
      return write([undefined], async () => {
        const renamed = { ...requireAccount(accountId), label }
        await deps.vaultAccounts.put(accountId, renamed)
        return renamed
      })
    },
    removeAccount(accountId) {
      const affected = grantsWhere((record) => record.accountId === accountId)
      return write([undefined, ...affected.map((record) => record.botId)], async () => {
        const removed = grantsWhere((record) => record.accountId === accountId)
        for (const record of removed) await forgetGrant(record)
        await deps.vaultAccounts.delete(accountId)
        await pruneFingerprints()
        return removed
      })
    },
    grant: (botId, grantId) => deps.vaultGrants.get(vaultGrantKey(botId, grantId)),
    grants: (botId) => grantsWhere((record) => record.botId === botId),
    grantsOfAccount: (accountId) => grantsWhere((record) => record.accountId === accountId),
    putGrant(record) {
      return write([record.botId, undefined], async () => {
        requireAccount(record.accountId)
        await deps.vaultGrants.put(vaultGrantKey(record.botId, record.id), record)
      })
    },
    removeGrant(botId, grantId) {
      return write([botId, undefined], async () => {
        const record = deps.vaultGrants.get(vaultGrantKey(botId, grantId))
        if (record !== undefined) await forgetGrant(record)
        await pruneFingerprints()
      })
    },
    recordUse(record) {
      return write([record.botId], async () => {
        await deps.vaultUses.put(record.id, record)
        const oldest = deps.now() - USE_RETENTION_MS
        const mine = newestFirst(values(deps.vaultUses).filter((use) => use.botId === record.botId))
        for (const [index, use] of mine.entries()) {
          if (index >= MAX_USES_PER_BOT || use.at < oldest) await deps.vaultUses.delete(use.id)
        }
      })
    },
    uses: (botId) => newestFirst(values(deps.vaultUses).filter((use) => use.botId === botId)),
    fingerprint: (botId, grantId, kind) =>
      deps.vaultFingerprints.get(vaultFingerprintKey(botId, grantId, kind)),
    fingerprints: (botId) =>
      values(deps.vaultFingerprints).filter((record) => record.botId === botId),
    putFingerprint(record) {
      return write([record.botId], async () => {
        if (deps.vaultGrants.get(vaultGrantKey(record.botId, record.grantId)) === undefined) return
        await deps.vaultFingerprints.put(printKey(record), record)
        await pruneFingerprints()
      })
    },
    recordIncident(record) {
      return write([record.botId], async () => {
        const repeated = values(deps.vaultIncidents).find(
          (incident) =>
            incident.botId === record.botId &&
            incident.acknowledgedAt === undefined &&
            incident.grantId === record.grantId &&
            incident.kind === record.kind &&
            incident.source === record.source &&
            incident.outcome === record.outcome,
        )
        if (repeated !== undefined) {
          const merged = { ...repeated, repeats: (repeated.repeats ?? 0) + 1, lastAt: record.at }
          await deps.vaultIncidents.put(repeated.id, merged)
          return merged
        }
        await deps.vaultIncidents.put(record.id, record)
        const oldest = deps.now() - INCIDENT_RETENTION_MS
        const settled = newestFirst(
          values(deps.vaultIncidents).filter(
            (incident) => incident.botId === record.botId && incident.acknowledgedAt !== undefined,
          ),
        )
        for (const [index, incident] of settled.entries()) {
          if (index >= MAX_INCIDENTS_PER_BOT || incident.at < oldest) {
            await deps.vaultIncidents.delete(incident.id)
          }
        }
        return record
      })
    },
    incidents: (botId) =>
      newestFirst(values(deps.vaultIncidents).filter((incident) => incident.botId === botId)),
    acknowledge(botId, incidentId) {
      return write([botId], async () => {
        const record = deps.vaultIncidents.get(incidentId)
        if (record === undefined || record.botId !== botId) throw new Error("no such incident")
        if (record.acknowledgedAt !== undefined) return record
        const acknowledged = { ...record, acknowledgedAt: deps.now() }
        await deps.vaultIncidents.put(incidentId, acknowledged)
        return acknowledged
      })
    },
    openIncidents() {
      const counts: Record<string, number> = {}
      for (const incident of values(deps.vaultIncidents)) {
        if (incident.acknowledgedAt === undefined) {
          counts[incident.botId] = (counts[incident.botId] ?? 0) + 1
        }
      }
      return counts
    },
    purgeBots(keep) {
      const gone = new Set(
        [
          ...values(deps.vaultGrants),
          ...values(deps.vaultUses),
          ...values(deps.vaultIncidents),
          ...values(deps.vaultFingerprints),
        ]
          .map((record) => record.botId)
          .filter((botId) => !keep(botId)),
      )
      if (gone.size === 0) return Promise.resolve()
      return write([undefined, ...gone], async () => {
        for (const record of values(deps.vaultGrants)) {
          if (gone.has(record.botId))
            await deps.vaultGrants.delete(vaultGrantKey(record.botId, record.id))
        }
        for (const record of values(deps.vaultFingerprints)) {
          if (gone.has(record.botId)) await deps.vaultFingerprints.delete(printKey(record))
        }
        for (const record of values(deps.vaultUses)) {
          if (gone.has(record.botId)) await deps.vaultUses.delete(record.id)
        }
        for (const record of values(deps.vaultIncidents)) {
          if (gone.has(record.botId)) await deps.vaultIncidents.delete(record.id)
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
