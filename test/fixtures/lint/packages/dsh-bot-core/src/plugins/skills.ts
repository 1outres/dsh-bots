declare const ctx: {
  on(name: string, listener: unknown): void
  tools: { register(definition: object): () => void }
}

ctx.on("agent/pre-step", async () => undefined)
ctx.tools.register({ name: "skill_manage" })
