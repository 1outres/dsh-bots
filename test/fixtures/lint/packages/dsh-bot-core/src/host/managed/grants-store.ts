declare const deps: {
  workspaceGrants: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(key: string, grant: unknown) {
  await deps.workspaceGrants.put(key, grant)
  await deps.workspaceGrants.delete(key)
}
