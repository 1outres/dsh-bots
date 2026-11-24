export function mask(agent: { ctx: { tools: { restrict(filter: object): void } } }) {
  agent.ctx.tools.restrict({ deny: ["fs"] }) // rule: 3
}
