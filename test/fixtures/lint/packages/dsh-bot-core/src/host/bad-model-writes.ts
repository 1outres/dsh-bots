declare const deps: {
  models: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  modelStore: { create(key: string, value: unknown): Promise<void> }
}

export async function write(id: string, record: unknown) {
  await deps.models.put(id, record)
  await deps.models.delete(id)
  await deps.modelStore.create(id, record)
}
