interface Registry {
  create(path: string): Promise<unknown>
  delete(id: string): Promise<unknown>
  archiveSession(id: string): Promise<unknown>
  get(id: string): unknown
}
export async function touch(services: { workspaceRegistry: Registry }) {
  await services.workspaceRegistry.create("/tmp")
  await services.workspaceRegistry.delete("w")
  await services.workspaceRegistry.archiveSession("s")
  return services.workspaceRegistry.get("w")
}
