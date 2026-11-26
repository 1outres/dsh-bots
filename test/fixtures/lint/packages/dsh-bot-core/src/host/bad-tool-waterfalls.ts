declare const ctx: { on(name: string, listener: unknown): void }

ctx.on("tools/post-execute", async () => undefined)
ctx.on("tools/pre-execute", async () => undefined)
ctx.on("tools/change", () => undefined)
