declare const deps: {
  jobs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  runs: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}

export async function bypass(value: unknown) {
  await deps.jobs.put("j", value) // rule: 42
  await deps.jobs.delete("j") // rule: 42
  await deps.runs.put("r", value) // rule: 42
  await deps.runs.delete("r") // rule: 42
}
