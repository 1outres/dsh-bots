declare const deps: {
  events: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  cursors: { put(key: string, value: unknown): Promise<void> }
}

export async function store(id: string, record: unknown) {
  await deps.events.put(id, record)
  await deps.cursors.put(id, record)
}
