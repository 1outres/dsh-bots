declare const deps: {
  mainOverrides: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  mainActivity: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function store(id: string, value: unknown) {
  await deps.mainOverrides.put(id, value)
  await deps.mainActivity.delete(id)
}
