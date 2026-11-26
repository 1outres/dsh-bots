declare const deps: {
  mainSettings: { put(key: string, value: unknown): Promise<void> }
  mainOverrides: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  mainActivity: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function bypass(value: unknown) {
  await deps.mainSettings.put("defaults", value)
  await deps.mainOverrides.delete("b")
  await deps.mainActivity.put("b", value)
}
