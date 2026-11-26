import {
  type CredentialRecords,
  readSecrets,
  secretRecordKey,
  writeSecrets,
} from "../secret-record"

export interface WebSecretVault {
  read(backendId: string): Promise<Readonly<Record<string, string>>>
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
