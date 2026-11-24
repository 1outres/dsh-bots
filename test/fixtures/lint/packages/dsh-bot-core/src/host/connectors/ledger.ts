declare const deps: { actions: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> } }

export async function store(id: string, action: unknown) {
  await deps.actions.put(id, action)
  await deps.actions.delete(id)
}
