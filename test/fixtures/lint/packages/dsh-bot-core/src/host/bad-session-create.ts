export function start(services: { sessionController: { create(request: object): unknown } }) {
  return services.sessionController.create({ workspaceId: "w" }) // rule: 1
}
export function bare(sessionController?: { create(): unknown }) {
  return sessionController?.create() // rule: 1
}
export function agent(host: { agents: { create(options: object): unknown } }) {
  return host.agents.create({ sessionId: "s" }) // rule: 1
}
export function bareAgents(agents?: { create(): unknown }) {
  return agents?.create() // rule: 1
}
