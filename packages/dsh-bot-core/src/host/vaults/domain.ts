import { z } from "zod"
import { VAULT_ACCOUNT_STATUSES, VAULT_FIELD_KINDS, VAULT_SECRET_KINDS } from "../../shared/vaults"

const time = z.number().int().nonnegative()
const id = z.string().min(1)
const fieldKind = z.enum(VAULT_FIELD_KINDS)
const secretKind = z.enum(VAULT_SECRET_KINDS)

/** A connected password manager account, keyed by its id; its setup secrets are a credential record. */
export const vaultAccountRecordSchema = z.object({
  id,
  provider: id,
  label: id,
  subject: id,
  status: z.enum(VAULT_ACCOUNT_STATUSES),
  statusReason: z.string().optional(),
  createdAt: time,
})

/** A login a bot may use, keyed by {@link vaultGrantKey}. */
export const vaultGrantRecordSchema = z.object({
  id,
  botId: id,
  accountId: id,
  vaultId: id,
  itemId: id,
  label: id,
  kinds: z.array(fieldKind),
  sites: z.array(z.object({ origin: id, subdomains: z.boolean() })),
  desktop: z.boolean(),
  showUsername: z.boolean(),
  /** Absent in records stored before connectors were chosen: no connector may fill them. */
  connectors: z.array(id).default([]),
  grantedAt: time,
})

const useTarget = z.union([
  z.object({ kind: z.literal("browser"), origin: id }),
  z.object({ kind: z.literal("desktop"), application: z.string() }),
])

/** One reveal (never its value), keyed by its id. */
export const vaultUseRecordSchema = z.object({
  id,
  botId: id,
  grantId: id,
  kind: fieldKind,
  connector: id,
  tool: id,
  sessionId: z.string().optional(),
  target: useTarget,
  at: time,
  outcome: z.enum(["filled", "refused"]),
  reason: z.string().optional(),
})

/**
 * The leak guard's fingerprints of one secret of a login, keyed by
 * {@link vaultFingerprintKey}: made with the guard key `keyId`, kept for a
 * while after the login is removed (`revokedAt`), under the login's name then.
 */
export const vaultFingerprintRecordSchema = z.object({
  botId: id,
  grantId: id,
  kind: secretKind,
  label: z.string().default(""),
  /** Absent in records stored before guard key ids: stale, so the guard fails closed. */
  keyId: z.string().default(""),
  revokedAt: time.optional(),
  state: z.enum(["fingerprinted", "short"]),
  prints: z.array(
    z.object({
      variant: id,
      length: z.number().int().positive(),
      probe: z.number().int().nonnegative(),
      digest: id,
    }),
  ),
  at: time,
})

/** A secret found where a bot reads or writes, keyed by its id. */
export const vaultIncidentRecordSchema = z.object({
  id,
  botId: id,
  sessionId: z.string().optional(),
  at: time,
  source: z.enum([
    "tool-result",
    "tool-arguments",
    "assistant-message",
    "inbound-message",
    "bot-context",
  ]),
  tool: z.string().optional(),
  grantId: id,
  label: id,
  kind: secretKind,
  outcome: z.enum(["redacted", "exposed"]),
  acknowledgedAt: time.optional(),
  repeats: z.number().int().positive().optional(),
  lastAt: time.optional(),
})

export type VaultAccountRecord = z.infer<typeof vaultAccountRecordSchema>
export type VaultGrantRecord = z.infer<typeof vaultGrantRecordSchema>
export type VaultUseRecord = z.infer<typeof vaultUseRecordSchema>
export type VaultFingerprintRecord = z.infer<typeof vaultFingerprintRecordSchema>
export type VaultIncidentRecord = z.infer<typeof vaultIncidentRecordSchema>

export const vaultGrantKey = (botId: string, grantId: string) => `${botId}:${grantId}`

export const vaultFingerprintKey = (botId: string, grantId: string, kind: string) =>
  `${botId}:${grantId}:${kind}`

/**
 * Password manager accounts, the bots' logins of their items, the uses of
 * those logins, the leak guard's fingerprints and its incidents (design rule
 * 27). Only host/vaults/store.ts writes it (design rule 58).
 */
export const VAULTS_DOMAIN = {
  name: "dsh_bot_vaults",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: {
    accounts: { valueSchema: vaultAccountRecordSchema },
    grants: { valueSchema: vaultGrantRecordSchema },
    uses: { valueSchema: vaultUseRecordSchema },
    fingerprints: { valueSchema: vaultFingerprintRecordSchema },
    incidents: { valueSchema: vaultIncidentRecordSchema },
  },
} as const
