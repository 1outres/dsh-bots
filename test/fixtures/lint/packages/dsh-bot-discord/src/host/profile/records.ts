declare const tables: { profiles: { put(key: string, value: unknown): Promise<void> } }

export async function save() {
  await tables.profiles.put("k", {})
}
