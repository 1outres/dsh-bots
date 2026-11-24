interface Registry {
  delete(id: string): Promise<unknown>
  archiveSession(id: string): Promise<unknown>
}
export async function clean(services: { workspaceRegistry: Registry }) {
  await services.workspaceRegistry.archiveSession("s")
  await services.workspaceRegistry.delete("w")
}
