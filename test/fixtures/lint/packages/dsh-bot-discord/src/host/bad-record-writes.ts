declare const tables: {
  cards: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
  digests: { put(key: string, value: unknown): Promise<void> }
}
declare const incidents: { put(key: string, value: unknown): Promise<void>; get(key: string): unknown }

export async function bypass() {
  await tables.cards.put("k", {}) // rule: 72
  await tables.cards.delete("k") // rule: 72
  await tables.digests.put("k", {}) // rule: 72
  await incidents.put("k", {}) // rule: 72
  return incidents.get("k")
}
