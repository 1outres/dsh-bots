declare const deps: {
  shared: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(id: string, value: unknown) {
  await deps.shared.put(id, value)
  await deps.shared.delete(id)
}
