declare const deps: {
  connections: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  grants: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function store(id: string, record: unknown) {
  await deps.connections.put(id, record)
  await deps.grants.delete(id)
}
