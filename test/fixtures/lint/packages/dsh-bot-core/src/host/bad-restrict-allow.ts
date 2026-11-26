export function mask(agent: { tools: { restrict(filter: object): void } }, allow: string[]) {
  agent.tools.restrict({ allow: ["fs"] })
  agent.tools.restrict({ allow })
}
