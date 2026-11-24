declare const deps: {
  jobs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  runs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function store(id: string, value: unknown) {
  await deps.jobs.put(id, value)
  await deps.runs.delete(id)
}
