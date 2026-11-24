import {
  type CredentialRecords,
  readSecrets,
  secretRecordKey,
  writeSecrets,
} from "../secret-record"

/**
 * Secrets of web backends: one DSH credential record per backend
 * (`bot-core/web-<backend>`), shared by every bot. Nothing here returns a
 * secret to the browser; a backend that goes away keeps its record.
 */
export interface WebSecretVault {
  /** The stored secrets, by key ({} when none). @throws when the record is not bot-core's. */
  read(backendId: string): Promise<Readonly<Record<string, string>>>
  /** Set one secret, or clear it with `undefined`; the others stay. */
  change(
    backendId: string,
    key: string,
    value: string | undefined,
  ): Promise<Readonly<Record<string, string>>>
}

export function webVaultKey(backendId: string): string {
  return secretRecordKey(`web-${backendId}`)
}

export function createWebSecretVault(records: CredentialRecords): WebSecretVault {
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  return {
    read: (backendId) => readSecrets(records, webVaultKey(backendId)),
    change: (backendId, key, value) =>
      serial(async () => {
        const recordKey = webVaultKey(backendId)
        const { [key]: _old, ...rest } = await readSecrets(records, recordKey)
        const next = value === undefined ? rest : { ...rest, [key]: value }
        await writeSecrets(records, recordKey, next)
        return next
      }),
  }
}
