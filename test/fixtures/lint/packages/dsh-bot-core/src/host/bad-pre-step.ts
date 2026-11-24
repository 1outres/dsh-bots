declare const ctx: { on(name: string, listener: unknown): void }

ctx.on("agent/pre-step", async () => undefined) // rule: 50
ctx.on("agent/status", () => undefined)
