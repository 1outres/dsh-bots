/**
 * bot-core's `working-directory/access` listener against DSH's real
 * `@deepseek-ai/dsh-working-directory` service (real Cordis events): the Host
 * service returns the environment's workspace for a bot Agent without
 * touching the Host's file system, while an ordinary Agent still goes through
 * the Host's own check.
 */
import { Context, Service } from "@deepseek-ai/cordis"
// A root devDependency for this test alone: bot-core never imports it (the Host provides it).
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory"
import { describe, expect, it } from "vitest"
import { createSessionIdentity } from "../src/host/preset/identity"
import { createWorkingDirectoryAccess, type EnvironmentFs } from "../src/host/working-directory"

interface FakeSession {
  header: { id: string; cwd?: string; agentPreset?: string; parentSession?: string }
  events: { type: string; data: { cwd: string } }[]
  append(type: string, data: { cwd: string }): void
}

interface FakeAgent {
  id: string
  ctx: { fiber: { assertActive(): void } }
  session: FakeSession
  injected: unknown[]
  inject(message: unknown): void
  /** The environment's fs when composed on a bot preset. */
  fs?: EnvironmentFs
}

/** A file system holding exactly `dirs`; every call is logged. */
function fileSystem(dirs: string[], calls: string[]) {
  const known = new Set(dirs)
  return {
    resolve: async (path: string, options?: { cwd?: string }) => {
      calls.push(`resolve ${path}`)
      return path.startsWith("/") ? path : `${options?.cwd ?? "/"}/${path}`
    },
    stat: async (target: string) => {
      calls.push(`stat ${target}`)
      return known.has(target) ? { type: "directory" } : undefined
    },
    processPath: (target: string) => target,
  }
}

function fake(name: string, body: object) {
  return class extends Service {
    constructor(ctx: Context) {
      super(ctx, name)
      Object.assign(this, body)
    }
  }
}

async function setup() {
  const ctx = new Context()
  const hostCalls: string[] = []
  const vmCalls: string[] = []
  const vmFs = fileSystem(["/home/bot/workspace", "/home/bot/workspace/sub"], vmCalls)
  // The Host has the user's project, and nothing under /home/bot.
  await ctx.plugin(fake("fs", fileSystem(["/home/me/project"], hostCalls)))
  await ctx.plugin(
    fake("sessionProjections", {
      register: async (definition: {
        init(header: FakeSession["header"]): string | null
        apply(state: string | null, event: FakeSession["events"][number]): string | null
      }) => ({
        stateOf: (session: FakeSession) =>
          session.events.reduce(
            (state, event) => definition.apply(state, event),
            definition.init(session.header),
          ),
      }),
    }),
  )
  await ctx.plugin(fake("systemPrompt", { context: () => () => {}, getContextOrder: () => 0 }))
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: "/" })
  const service = ctx.get("workingDirectory") as WorkingDirectoryService
  const agents = new Map<string, FakeAgent>()
  const access = createWorkingDirectoryAccess<FakeAgent>({
    sessionOf: createSessionIdentity<FakeAgent>({
      isBot: (botId) => botId === "a",
      recorded: () => undefined,
      agent: (id) => agents.get(id),
    }),
    fsOf: (agent) =>
      agent.fs ??
      (agent.session.header.parentSession === undefined
        ? undefined
        : agents.get(agent.session.header.parentSession)?.fs),
    current: (agent) => service.get(agent.session as never),
    original: (agent) => agent.session.header.cwd,
    workspace: () => "/home/bot/workspace",
    commit(agent, directory, notice, signal) {
      signal.throwIfAborted()
      agent.ctx.fiber.assertActive()
      agent.session.append("working-directory/change", { cwd: directory })
      agent.inject(notice)
    },
  })
  ;(ctx as unknown as { on(...args: unknown[]): () => void }).on(
    "working-directory/access",
    access,
    { prepend: true },
  )
  const agent = (
    id: string,
    header: Omit<FakeSession["header"], "id">,
    fs?: EnvironmentFs,
  ): FakeAgent => {
    const created: FakeAgent = {
      id,
      ctx: { fiber: { assertActive: () => {} } },
      session: {
        header: { id, ...header },
        events: [],
        append(type, data) {
          created.session.events.push({ type, data })
        },
      },
      injected: [],
      inject: (message) => {
        created.injected.push(message)
      },
      ...(fs === undefined ? {} : { fs }),
    }
    agents.set(id, created)
    return created
  }
  return { service, agent, hostCalls, vmCalls, vmFs }
}

describe("bot working directories under the real dsh-working-directory service", () => {
  it("returns the environment's workspace for a bot Agent, never touching the Host's fs", async () => {
    const { service, agent, hostCalls, vmCalls, vmFs } = await setup()
    const bot = agent("s1", { cwd: "/home/bot/workspace", agentPreset: "bot-a" }, vmFs)
    await expect(service.ensure(bot as never)).resolves.toBe("/home/bot/workspace")
    expect(hostCalls).toEqual([])
    expect(vmCalls).toEqual(["resolve /home/bot/workspace", "stat /home/bot/workspace"])
  })

  it("still checks an ordinary Agent with the Host's fs, and fails a missing Host directory as before", async () => {
    const { service, agent, hostCalls, vmCalls } = await setup()
    const normal = agent("w1", { cwd: "/home/me/project", agentPreset: "standard" })
    await expect(service.ensure(normal as never)).resolves.toBe("/home/me/project")
    expect(hostCalls).toContain("stat /home/me/project")
    // Without bot-core's answer, /home/bot/workspace fails on the Host.
    const stray = agent("w2", { cwd: "/home/bot/workspace", agentPreset: "standard" })
    await expect(service.ensure(stray as never)).rejects.toThrow("does not exist")
    expect(vmCalls).toEqual([])
  })

  it("changes a bot's directory in its environment; get() follows", async () => {
    const { service, agent, hostCalls, vmFs } = await setup()
    const bot = agent("s1", { cwd: "/home/bot/workspace", agentPreset: "bot-a" }, vmFs)
    await expect(service.set(bot as never, "sub")).resolves.toBe("/home/bot/workspace/sub")
    expect(service.get(bot.session as never)).toBe("/home/bot/workspace/sub")
    expect(bot.injected).toHaveLength(1)
    await expect(service.set(bot as never, "/home/me/project")).rejects.toThrow("does not exist")
    expect(hostCalls).toEqual([])
  })

  it("moves a legacy Host directory to the environment's workspace once", async () => {
    const { service, agent, hostCalls, vmFs } = await setup()
    const bot = agent("s1", { cwd: "/home/u/.dsh/bots/a", agentPreset: "bot-a" }, vmFs)
    await expect(service.ensure(bot as never)).resolves.toBe("/home/bot/workspace")
    await expect(service.ensure(bot as never)).resolves.toBe("/home/bot/workspace")
    expect(bot.session.events).toHaveLength(1)
    expect(bot.injected).toEqual([expect.stringContaining("is unavailable")])
    expect(hostCalls).toEqual([])
  })

  it("sets an uncomposed subagent's directory with its parent's environment", async () => {
    const { service, agent, hostCalls, vmFs } = await setup()
    agent("s1", { cwd: "/home/bot/workspace", agentPreset: "bot-a" }, vmFs)
    const child = agent("c1", {
      cwd: "/home/bot/workspace",
      agentPreset: "bot-a",
      parentSession: "s1",
    })
    await expect(service.set(child as never, "/home/bot/workspace")).resolves.toBe(
      "/home/bot/workspace",
    )
    expect(child.session.events).toEqual([])
    expect(hostCalls).toEqual([])
  })
})
