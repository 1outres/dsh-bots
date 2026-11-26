export async function read(services: { sessionQuery: { observeSession(id: string): Promise<unknown> } }) {
  return services.sessionQuery.observeSession("s")
}
