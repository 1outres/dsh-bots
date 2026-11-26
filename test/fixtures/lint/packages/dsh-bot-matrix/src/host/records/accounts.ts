declare const tables: { accounts: { put(key: string, value: unknown): Promise<void> } }

export async function activate() {
  await tables.accounts.put("k", {})
}
