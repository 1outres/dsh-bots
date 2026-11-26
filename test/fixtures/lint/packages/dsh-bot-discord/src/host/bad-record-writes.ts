declare const tables: {
  cards: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
  digests: { put(key: string, value: unknown): Promise<void> }
}
declare const incidents: { put(key: string, value: unknown): Promise<void>; get(key: string): unknown }

export async function bypass() {
  await tables.cards.put("k", {})
  await tables.cards.delete("k")
  await tables.digests.put("k", {})
  await incidents.put("k", {})
  return incidents.get("k")
}
