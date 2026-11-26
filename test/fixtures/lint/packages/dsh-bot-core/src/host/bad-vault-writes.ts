declare const deps: {
  vaultAccounts: { put(key: string, value: unknown): Promise<void> }
  vaultGrants: { delete(key: string): Promise<unknown> }
  vaultUses: { put(key: string, value: unknown): Promise<void> }
  vaultFingerprints: { put(key: string, value: unknown): Promise<void> }
  vaultIncidents: { delete(key: string): Promise<unknown> }
}

export async function write(id: string, record: unknown) {
  await deps.vaultAccounts.put(id, record)
  await deps.vaultGrants.delete(id)
  await deps.vaultUses.put(id, record)
  await deps.vaultFingerprints.put(id, record)
  await deps.vaultIncidents.delete(id)
}
