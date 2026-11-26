declare const deps: {
  connections: { put(key: string, value: unknown): Promise<void> }
  grants: { delete(key: string): Promise<unknown> }
  clients: { put(key: string, value: unknown): Promise<void> }
  events: { put(key: string, value: unknown): Promise<void> }
  cursors: { delete(key: string): Promise<unknown> }
}

export async function write(id: string, record: unknown) {
  await deps.connections.put(id, record)
  await deps.grants.delete(id)
  await deps.clients.put(id, record)
  await deps.events.put(id, record)
  await deps.cursors.delete(id)
}
