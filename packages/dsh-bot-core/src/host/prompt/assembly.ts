/** The Agent an assembly is for (dsh-agent `assembleContextFor` puts it there). */
export function agentIdOf(context: object): string {
  const agent: unknown = Reflect.get(context, "agent")
  const id: unknown =
    typeof agent === "object" && agent !== null ? Reflect.get(agent, "id") : undefined
  if (typeof id !== "string") {
    throw new Error("bot-core: a bot's prompt is assembled only for one of its Agents")
  }
  return id
}
