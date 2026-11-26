export function start(services: { sessionController: { create(request: object): unknown } }) {
  return services.sessionController.create({ workspaceId: "w" })
}
export function bare(sessionController?: { create(): unknown }) {
  return sessionController?.create()
}
export function agent(host: { agents: { create(options: object): unknown } }) {
  return host.agents.create({ sessionId: "s" })
}
export function bareAgents(agents?: { create(): unknown }) {
  return agents?.create()
}
