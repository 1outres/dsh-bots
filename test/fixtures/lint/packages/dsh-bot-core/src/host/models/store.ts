declare const deps: {
  models: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function store(id: string, record: unknown) {
  await deps.models.put(id, record)
  await deps.models.delete(id)
}
