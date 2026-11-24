export function create(services: { sessionController: { create(request: object): unknown } }) {
  return services.sessionController.create({})
}
export function createAgent(host: { agents: { create(options: object): unknown } }) {
  return host.agents.create({ sessionId: "s" })
}
