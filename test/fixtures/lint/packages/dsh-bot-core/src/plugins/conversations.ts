export function apply(ctx: { tools: { register(definition: object): () => void } }) {
  return ctx.tools.register({ name: "conversation_search" })
}
