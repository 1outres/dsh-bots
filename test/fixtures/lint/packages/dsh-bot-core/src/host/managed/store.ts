declare const deps: {
  managedSessions: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(id: string, record: unknown) {
  await deps.managedSessions.put(id, record)
  await deps.managedSessions.delete(id)
}
