export function expose(ctx: { tools: { register(definition: object): () => void } }) {
  return ctx.tools.register({ name: "host_tool" })
}
