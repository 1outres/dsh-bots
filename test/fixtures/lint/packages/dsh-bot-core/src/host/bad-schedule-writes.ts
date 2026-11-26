declare const deps: {
  jobs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  runs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function bypass(value: unknown) {
  await deps.jobs.put("j", value)
  await deps.jobs.delete("j")
  await deps.runs.put("r", value)
  await deps.runs.delete("r")
}
