export async function read(services: { sessionQuery: { observeSession(id: string): Promise<unknown> } }) { // rule: 55
  return services.sessionQuery.observeSession("s") // rule: 55
}
