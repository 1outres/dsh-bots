declare const deps: {
  skillHistory: { put(key: string, value: unknown): Promise<void> }
  skillSettings: { delete(key: string): Promise<unknown> }
}

export async function store(id: string, value: unknown) {
  await deps.skillHistory.put(id, value)
  await deps.skillSettings.delete(id)
}
