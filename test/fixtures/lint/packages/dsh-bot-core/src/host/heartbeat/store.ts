declare const deps: {
  heartbeatSettings: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(id: string, value: unknown) {
  await deps.heartbeatSettings.put(id, value)
  await deps.heartbeatSettings.delete(id)
}
