declare const deps: {
  spaces: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  revisions: { put(key: string, value: unknown): Promise<void> }
  access: { delete(key: string): Promise<unknown> }
  kv: { put(key: string, value: unknown): Promise<void> }
  spaceSettings: { put(key: string, value: unknown): Promise<void> }
}

export async function store(id: string, value: unknown) {
  await deps.spaces.put(id, value)
  await deps.spaces.delete(id)
  await deps.revisions.put(id, value)
  await deps.access.delete(id)
  await deps.kv.put(id, value)
  await deps.spaceSettings.put(id, value)
}
