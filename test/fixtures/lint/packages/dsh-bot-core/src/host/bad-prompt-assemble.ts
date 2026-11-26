declare const ctx: { on(name: string, listener: unknown): void }

ctx.on("system-prompt/assemble", async () => undefined)
ctx.on("system-prompt/change", () => undefined)
