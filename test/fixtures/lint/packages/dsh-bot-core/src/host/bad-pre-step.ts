declare const ctx: { on(name: string, listener: unknown): void }

ctx.on("agent/pre-step", async () => undefined)
ctx.on("agent/status", () => undefined)
