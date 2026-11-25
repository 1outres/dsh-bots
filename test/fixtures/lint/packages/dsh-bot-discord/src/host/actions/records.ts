declare const record: { put(key: string, value: unknown): Promise<void> }
declare const tables: { incidents: typeof record; cards: typeof record; digests: typeof record }

export async function save() {
  await tables.incidents.put("k", {})
  await tables.cards.put("k", {})
  await tables.digests.put("k", {})
}
