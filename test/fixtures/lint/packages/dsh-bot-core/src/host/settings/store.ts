declare const deps: {
  settingChanges: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(id: string, value: unknown) {
  await deps.settingChanges.put(id, value)
  await deps.settingChanges.delete(id)
}
