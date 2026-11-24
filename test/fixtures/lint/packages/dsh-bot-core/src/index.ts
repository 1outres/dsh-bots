// The composition root may wire every Host service, read the clock and cast the Context.
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import type { Context } from "@deepseek-ai/cordis"

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    bot: { kind: "bot" }
  }
}

interface Services {
  sessionController: { create(request: object): Promise<unknown> }
  agents: { create(options: object): Promise<unknown> }
  agentPresets: { register(preset: object): Promise<unknown> }
  workspaceRegistry: {
    create(path: string): Promise<unknown>
    delete(id: string): Promise<unknown>
    archiveSession(id: string): Promise<unknown>
  }
}

export async function apply(ctx: Context): Promise<void> {
  const services = ctx as unknown as Services
  const events = ctx as unknown as { on(name: string, listener: () => void): void }
  await mkdir(homedir())
  await services.sessionController.create({ id: randomUUID() })
  await services.agents.create({ sessionId: randomUUID() })
  await services.agentPresets.register({})
  await services.workspaceRegistry.create("/tmp")
  await services.workspaceRegistry.delete("w")
  await services.workspaceRegistry.archiveSession("s")
  const agent = ctx as unknown as { ctx: { tools: { restrict(filter: object): void } } }
  agent.ctx.tools.restrict({ deny: [] })
  events.on("agent/created", () => {})
  events.on("user-questions/request", () => {})
  events.on("approval/request", () => {})
  const session = ctx as unknown as { append(type: string, data: unknown): void }
  session.append("approval/policy", { policy: "never" })
  setTimeout(() => {}, Date.now())
  const history = ctx as unknown as { sessionQuery: { observeSession(id: string): Promise<unknown> } }
  await history.sessionQuery.observeSession("s")
}
