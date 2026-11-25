declare const deps: {
  vaultAccounts: { put(key: string, value: unknown): Promise<void> }
  vaultGrants: { delete(key: string): Promise<unknown> }
  vaultUses: { put(key: string, value: unknown): Promise<void> }
  vaultFingerprints: { put(key: string, value: unknown): Promise<void> }
  vaultIncidents: { delete(key: string): Promise<unknown> }
}

export async function write(id: string, record: unknown) {
  await deps.vaultAccounts.put(id, record) // rule: 58
  await deps.vaultGrants.delete(id) // rule: 58
  await deps.vaultUses.put(id, record) // rule: 58
  await deps.vaultFingerprints.put(id, record) // rule: 58
  await deps.vaultIncidents.delete(id) // rule: 58
}
