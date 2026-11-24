declare const deps: {
  webSettings: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function store(value: unknown) {
  await deps.webSettings.put("global", value)
  await deps.webSettings.delete("global")
}
