import {
  type CredentialRecords,
  readSecrets,
  secretRecordKey,
  writeSecrets,
} from "../secret-record"

export interface VaultRecords {
  setup(accountId: string): Promise<Readonly<Record<string, string>>>
  writeSetup(accountId: string, secrets: Readonly<Record<string, string>>): Promise<void>
  removeSetup(accountId: string): Promise<void>
  guardKeys(): Promise<GuardKeyMaterial>
}

export interface GuardKeyMaterial {
  readonly key: string
  readonly salt: string
}

export interface VaultRecordsDeps {
  records(): CredentialRecords
  random(bytes: number): string
}

const setupKey = (accountId: string) => secretRecordKey(`vault-${accountId}`)
const GUARD_KEY = secretRecordKey("vault-guard")

export function createVaultRecords(deps: VaultRecordsDeps): VaultRecords {
  let guard: Promise<GuardKeyMaterial> | undefined
  const loadGuard = async (): Promise<GuardKeyMaterial> => {
    const stored = await readSecrets(deps.records(), GUARD_KEY)
    if (typeof stored.key === "string" && typeof stored.salt === "string") {
      return { key: stored.key, salt: stored.salt }
    }
    const made = { key: deps.random(32), salt: deps.random(16) }
    await writeSecrets(deps.records(), GUARD_KEY, made)
    return made
  }
  return {
    setup: (accountId) => readSecrets(deps.records(), setupKey(accountId)),
    writeSetup: (accountId, secrets) => writeSecrets(deps.records(), setupKey(accountId), secrets),
    removeSetup: (accountId) => writeSecrets(deps.records(), setupKey(accountId), {}),
    guardKeys() {
      if (guard === undefined) {
        guard = loadGuard()
        guard.catch(() => {
          guard = undefined
        })
      }
      return guard
    },
  }
}
