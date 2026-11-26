declare const tables: {
  accounts: { put(key: string, value: unknown): Promise<void> }
  cursors: { delete(key: string): Promise<void> }
}

export async function bypass() {
  await tables.accounts.put("k", {})
  await tables.cursors.delete("k")
}
