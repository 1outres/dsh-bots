declare const deps: {
  vaultAccounts: { put(key: string, value: unknown): Promise<void> }
  vaultGrants: { delete(key: string): Promise<unknown> }
}

export async function store(id: string, record: unknown) {
  await deps.vaultAccounts.put(id, record)
  await deps.vaultGrants.delete(id)
}
