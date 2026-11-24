declare const deps: {
  webSettings: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}
declare const webSettings: { put(key: string, value: unknown): Promise<void> }

export async function bypass(value: unknown) {
  await deps.webSettings.put("global", value) // rule: 44
  await deps.webSettings.delete("global") // rule: 44
  await webSettings.put("global", value) // rule: 44
}
