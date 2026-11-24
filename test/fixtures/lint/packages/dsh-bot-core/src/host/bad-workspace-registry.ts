interface Registry {
  create(path: string): Promise<unknown>
  delete(id: string): Promise<unknown>
  archiveSession(id: string): Promise<unknown>
  get(id: string): unknown
}
export async function touch(services: { workspaceRegistry: Registry }) {
  await services.workspaceRegistry.create("/tmp") // rule: 7
  await services.workspaceRegistry.delete("w") // rule: 7
  await services.workspaceRegistry.archiveSession("s") // rule: 7
  return services.workspaceRegistry.get("w")
}
