export function mask(agent: { tools: { restrict(filter: object): void } }, allow: string[]) {
  agent.tools.restrict({ allow: ["fs"] }) // rule: 3 23
  agent.tools.restrict({ allow }) // rule: 3 23
}
