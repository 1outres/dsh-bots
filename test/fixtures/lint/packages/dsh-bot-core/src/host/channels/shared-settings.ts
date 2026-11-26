declare const deps: {
  shared: { put(key: string, value: unknown): Promise<void> }
}

export async function store(id: string, value: unknown) {
  await deps.shared.put(id, value)
}
