declare const deps: {
  webSettings: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}
declare const webSettings: { put(key: string, value: unknown): Promise<void> }

export async function bypass(value: unknown) {
  await deps.webSettings.put("global", value)
  await deps.webSettings.delete("global")
  await webSettings.put("global", value)
}
