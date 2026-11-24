declare const deps: {
  skillHistory: { put(key: string, value: unknown): Promise<void> }
  skillUsage: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  skillSettings: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  skillMarks: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  skillCuration: { put(key: string, value: unknown): Promise<void> }
}

export async function bypass(value: unknown) {
  await deps.skillHistory.put("b:x", value) // rule: 54
  await deps.skillUsage.delete("b:x") // rule: 54
  await deps.skillSettings.put("b", value) // rule: 54
  await deps.skillMarks.delete("b:x") // rule: 54
  await deps.skillCuration.put("b", value) // rule: 54
}
