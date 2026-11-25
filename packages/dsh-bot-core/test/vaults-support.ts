import { hkdfSync, randomBytes, scryptSync } from "node:crypto"
import { fakeVaultProvider } from "../../../dev/fake-vault/provider.js"
import type { CredentialRecords } from "../src/host/secret-record"
import { createVaultAccess } from "../src/host/vaults/access"
import { createVaultAvailability } from "../src/host/vaults/availability"
import { createVaultChecks } from "../src/host/vaults/checks"
import type {
  VaultAccountRecord,
  VaultFingerprintRecord,
  VaultGrantRecord,
  VaultIncidentRecord,
  VaultUseRecord,
} from "../src/host/vaults/domain"
import {
  type GuardKeys,
  ROLLING_HASH_BYTES,
  rollingHashFrom,
} from "../src/host/vaults/fingerprints"
import { createVaultGuard } from "../src/host/vaults/guard"
import { createVaultPanel } from "../src/host/vaults/panel"
import { createVaultProviders } from "../src/host/vaults/providers"
import { createVaultRecords } from "../src/host/vaults/records"
import { createVaultSessions } from "../src/host/vaults/sessions"
import { createVaultStore } from "../src/host/vaults/store"
import type { VaultIncidentView } from "../src/shared/vaults"
import { SecretBytes } from "../src/vault-contract"
import { memoryTable } from "./channels-support"

export const OWNER = { kind: "owner" }
export const VIEWER = { kind: "viewer" }

/** The example items' secrets (dev/fake-vault/items.example.json). */
export const EXAMPLE = {
  vaultId: "botsvault1",
  login: { itemId: "example1", password: "correct-horse-battery-1" },
  local: { itemId: "localtest1", password: "fake-vault-Pa55word!" },
  short: { itemId: "shortpin1", password: "1234" },
} as const

/** DSH's credential store in memory. */
export function memoryCredentials(): CredentialRecords & { records: Map<string, unknown> } {
  const records = new Map<string, unknown>()
  return {
    records,
    async readRecord(key) {
      const record = records.get(key)
      return record === undefined ? undefined : { kind: "grant", payload: record }
    },
    async modifyRecord(key, mutate) {
      const next = await mutate()
      if (next === undefined) records.delete(key)
      else records.set(key, next.payload)
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

/** Guard keys as bot-core derives them (src/index.ts), from a key and a salt. */
export function testGuardKeys(key: Uint8Array, salt: Uint8Array): GuardKeys {
  const derive = (info: string, length: number) =>
    new Uint8Array(hkdfSync("sha256", key, salt, `dsh-bot-core vault-guard ${info}`, length))
  return {
    id: Buffer.from(derive("key id", 8)).toString("hex"),
    hash: rollingHashFrom(derive("rolling hash", ROLLING_HASH_BYTES)),
    salt,
  }
}

/** A cheap scrypt, for tests only. */
export const testDigest = async (bytes: Uint8Array, salt: Uint8Array) =>
  scryptSync(bytes, salt, 32, { N: 1024, r: 8, p: 1 }).toString("base64")

export function vaultHarness(options: { readonly scanLimit?: number } = {}) {
  let now = 1_000_000
  let ids = 0
  const tables = {
    vaultAccounts: memoryTable<VaultAccountRecord>(),
    vaultGrants: memoryTable<VaultGrantRecord>(),
    vaultUses: memoryTable<VaultUseRecord>(),
    vaultFingerprints: memoryTable<VaultFingerprintRecord>(),
    vaultIncidents: memoryTable<VaultIncidentRecord>(),
  }
  const store = createVaultStore({ ...tables, now: () => now })
  const providers = createVaultProviders()
  const credentials = memoryCredentials()
  const records = createVaultRecords({
    records: () => credentials,
    random: (bytes) => randomBytes(bytes).toString("base64"),
  })
  const warnings: string[] = []
  const sessions = createVaultSessions({ store, providers, records, warn: (m) => warnings.push(m) })
  const availability = createVaultAvailability()
  const reported: VaultIncidentView[] = []
  const guard = createVaultGuard({
    store,
    keys: async () => {
      const material = await records.guardKeys()
      return testGuardKeys(
        Buffer.from(material.key, "base64"),
        Buffer.from(material.salt, "base64"),
      )
    },
    digest: testDigest,
    report: (incident) => reported.push(incident),
    newId: () => `vinc-${++ids}`,
    now: () => now,
    scanLimit: options.scanLimit ?? 256 * 1024,
  })
  const access = createVaultAccess({
    store,
    providers,
    sessions,
    guard,
    availability,
    newId: () => `vuse-${++ids}`,
    now: () => now,
    warn: (m) => warnings.push(m),
  })
  const checks = createVaultChecks({
    guard,
    sessionOf: (agentId) => `session-of-${agentId}`,
    warn: (m) => warnings.push(m),
  })
  const bots = new Set(["a", "b"])
  const panel = createVaultPanel({
    store,
    providers,
    sessions,
    records,
    access,
    availability,
    guard,
    fillers: () => [{ id: "browser", name: "Browser" }],
    onFillersChange: () => () => {},
    exists: (botId) => bots.has(botId),
    newId: (prefix) => `${prefix}-${(++ids).toString(16).padStart(8, "0")}`,
    now: () => now,
    deadline: () => new AbortController().signal,
  })
  const provider = fakeVaultProvider({ secret: (bytes) => SecretBytes.from(bytes), now: () => now })
  providers.register(provider)
  const addAccount = () =>
    panel.addAccount(OWNER, { provider: "fake-vault", label: "Vault", values: { token: "t0ken" } })
  return {
    tables,
    store,
    providers,
    provider,
    credentials,
    records,
    sessions,
    availability,
    guard,
    access,
    checks,
    panel,
    bots,
    reported,
    warnings,
    addAccount,
    advance(ms: number) {
      now += ms
    },
  }
}

export type VaultHarness = ReturnType<typeof vaultHarness>

export const forRun = (
  h: VaultHarness,
  options: { botId?: string; connector?: string; signal?: AbortSignal } = {},
) =>
  h.access.forRun({
    botId: options.botId ?? "a",
    connector: options.connector ?? "browser",
    tool: "browser_fill_credential",
    sessionId: "session-1",
    signal: options.signal ?? new AbortController().signal,
  })

export const run = (h: VaultHarness, botId = "a") => forRun(h, { botId }).access

/** Read a secret's bytes as text, in a test only. */
export const textOf = (secret: SecretBytes) =>
  secret.use((bytes) => new TextDecoder().decode(bytes))
