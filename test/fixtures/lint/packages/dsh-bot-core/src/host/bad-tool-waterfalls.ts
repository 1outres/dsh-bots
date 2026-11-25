declare const ctx: { on(name: string, listener: unknown): void }

ctx.on("tools/post-execute", async () => undefined) // rule: 60
ctx.on("tools/pre-execute", async () => undefined) // rule: 60
ctx.on("tools/change", () => undefined)
