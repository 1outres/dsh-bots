declare const deps: {
  managedSessions: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
  managed: { start(key: string, value: unknown): Promise<void> }
}

export async function write(id: string, record: unknown) {
  await deps.managedSessions.put(id, record) // rule: 53
  await deps.managedSessions.delete(id) // rule: 53
  await deps.managed.start(id, record)
}
