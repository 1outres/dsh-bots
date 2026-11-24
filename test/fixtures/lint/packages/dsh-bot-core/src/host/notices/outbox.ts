declare const deps: { notices: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> } }

export async function store(id: string, notice: unknown) {
  await deps.notices.put(id, notice)
  await deps.notices.delete(id)
}
