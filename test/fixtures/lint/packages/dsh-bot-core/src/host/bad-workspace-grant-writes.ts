declare const deps: {
  workspaceGrants: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
  grants: { grant(key: string, value: unknown): Promise<void> }
}

export async function write(key: string, grant: unknown) {
  await deps.workspaceGrants.put(key, grant) // rule: 56
  await deps.workspaceGrants.delete(key) // rule: 56
  await deps.grants.grant(key, grant)
}
