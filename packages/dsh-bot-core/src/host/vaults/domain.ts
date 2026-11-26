import { z } from "zod"
import { VAULT_ACCOUNT_STATUSES, VAULT_FIELD_KINDS, VAULT_SECRET_KINDS } from "../../shared/vaults"

const time = z.number().int().nonnegative()
const id = z.string().min(1)
const fieldKind = z.enum(VAULT_FIELD_KINDS)
const secretKind = z.enum(VAULT_SECRET_KINDS)

export const vaultAccountRecordSchema = z.object({
  id,
  provider: id,
  label: id,
  subject: id,
  status: z.enum(VAULT_ACCOUNT_STATUSES),
  statusReason: z.string().optional(),
  createdAt: time,
})

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
  connectors: z.array(id).default([]),
  grantedAt: time,
})

const useTarget = z.union([
  z.object({ kind: z.literal("browser"), origin: id }),
  z.object({ kind: z.literal("desktop"), application: z.string() }),
])

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

export const vaultFingerprintRecordSchema = z.object({
  botId: id,
  grantId: id,
  kind: secretKind,
  label: z.string().default(""),
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
