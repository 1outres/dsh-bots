interface Agent {
  ctx: { tools: { restrict(filter: { deny: string[] }): () => void } }
}
export function mask(agent: Agent, events: { on(name: string, f: () => void): void }) {
  events.on("agent/created", () => {})
  return agent.ctx.tools.restrict({ deny: ["fs"] })
}
