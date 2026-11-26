import { Context, Service } from "@deepseek-ai/cordis"
import { EntryTree, Group, Loader } from "@deepseek-ai/cordis-plugin-loader"
import { bindScopeParent, createScope } from "@deepseek-ai/dsh-scope"
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt"
import { type ToolDefinition, ToolsService } from "@deepseek-ai/dsh-tools"
import { executeToolBatch, ToolExecutionPipeline } from "@deepseek-ai/dsh-tools/pipeline"
import { describe, expect, it } from "vitest"
import { createVaultRows } from "../src/host/vaults/rows"
import {
  GUARD_TOOL_ARGUMENTS,
  GUARD_TOOL_RESULT,
  type GuardArgumentsRequest,
  type GuardResultRequest,
} from "../src/internal"
import BotVaultGuard from "../src/plugins/vault-guard"
import { EXAMPLE, OWNER, vaultHarness } from "./vaults-support"

const SECRET = "hunter2-correct-horse"

const textTool = (
  name: string,
  body: (args: unknown, exec: never) => Promise<string>,
): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: "object", properties: {}, additionalProperties: true },
  output: {
    schema: { type: "string" },
    render: (_args, value) => [{ type: "text", text: value as string }],
  },
  execute: (args, exec) => body(args, exec as never),
})

class Guard {
  static inject = ["tools"]
  constructor(ctx: Context) {
    ctx.on("tools/post-execute", async (_exec, result, next) => {
      const decision = await next()
      const text = JSON.stringify(result.content)
      if (!text.includes(SECRET)) return decision
      return { kind: "accept", content: [{ type: "text", text: "[withheld]" }] }
    })
  }
}

class ConnectorRow {
  static inject = ["tools"]
  constructor(ctx: Context) {
    ctx.effect(() => ctx.tools.register(textTool("probe_read", async () => `page: ${SECRET}`)))
  }
}

const harness = vaultHarness()
const BOT_AGENTS = new Set(["main", "helper", "child"])
const rows = createVaultRows<{ id: string }>({
  sealed: (botId, token) => botId === "a" && token === "sealed",
  agent: (agentId) => ({ id: agentId }),
  botOf: (agent) => (BOT_AGENTS.has(agent.id) ? "a" : undefined),
  checks: harness.checks,
  access: harness.access,
  store: harness.store,
})

class FakeBot extends Service {
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  [GUARD_TOOL_ARGUMENTS](botId: string, token: string, request: GuardArgumentsRequest) {
    return rows.guardArguments(botId, token, request)
  }
  [GUARD_TOOL_RESULT](botId: string, token: string, request: GuardResultRequest) {
    return rows.guardResult(botId, token, request)
  }
}

const modules: Record<string, unknown> = {
  "cordis:group": Group,
  "@test/guard": Guard,
  "@test/connector": ConnectorRow,
  "@1outres/dsh-bot-core/vault-guard": BotVaultGuard,
}

class TestLoader extends Loader {
  override import(name: string) {
    return Promise.resolve(modules[name])
  }
  commit() {}
}

class PresetTree extends EntryTree {
  override import(name: string) {
    return Promise.resolve(modules[name])
  }
  commit() {}
}

async function host() {
  const root = new Context()
  await root.plugin(TestLoader)
  await root.plugin(SystemPrompt, {})
  await root.plugin(ToolsService)
  await root.plugin(FakeBot)
  const tools = root.get("tools") as unknown as ToolsService
  const pipeline = new ToolExecutionPipeline(root)
  tools.setExecutor({
    describe: () => ({ schemas: [] }),
    execute: (input) => executeToolBatch(input, pipeline, () => 4),
  })
  let owner: Context | undefined
  await root.plugin({
    name: "agent-presets",
    inject: ["loader"],
    apply(ctx: Context) {
      owner = ctx
    },
  })
  const mount = async (rows: readonly object[]) => {
    const key = {}
    const scope = createScope(owner as Context, key)
    await scope.ctx.fiber.await()
    const tree = new PresetTree(scope.ctx)
    await tree.root.update(rows as never)
    await tree.await()
    return key
  }
  const agentOf = (id: string, parent: object | undefined) => {
    const agent = { id }
    if (parent !== undefined) bindScopeParent(agent, parent)
    return agent
  }
  let calls = 0
  const call = async (agent: object | undefined, name: string, args: object = {}) => {
    const batch = await tools.execute({
      calls: [
        {
          type: "tool-call",
          id: `call-${++calls}` as never,
          name,
          arguments: JSON.stringify(args),
        },
      ],
      signal: new AbortController().signal,
      ...(agent === undefined ? {} : { agent: agent as never }),
    })
    const result = batch.results[0]?.result
    if (result === undefined) throw new Error("no result")
    return result
  }
  const run = async (agent: object | undefined, name: string) =>
    JSON.stringify((await call(agent, name)).content)
  return { tools, mount, agentOf, run, call }
}

describe("tools/post-execute from a row in a bot's preset group", () => {
  it("replaces the results of standard, connector, nested and subagent tools of that bot's Agents only", async () => {
    const h = await host()
    h.tools.register(textTool("bash", async () => `stdout: ${SECRET}`))
    h.tools.register(
      textTool(
        "program",
        async (_args, exec: { agent?: object; token: symbol; signal: AbortSignal }) => {
          const nested = await h.tools.execute({
            calls: [{ type: "tool-call", id: "nested" as never, name: "bash", arguments: "{}" }],
            signal: exec.signal,
            ...(exec.agent === undefined ? {} : { agent: exec.agent as never }),
          })
          return `nested saw ${JSON.stringify(nested.results[0]?.result.content)}`
        },
      ),
    )
    const bot = await h.mount([
      { id: "connector", name: "@test/connector" },
      { id: "guard", name: "@test/guard" },
    ])
    const other = await h.mount([{ id: "connector", name: "@test/connector" }])
    const main = h.agentOf("main", bot)
    h.tools.register(
      textTool("subagent", async () => {
        const child = h.agentOf("child", main)
        return `child said ${await h.run(child, "bash")} and ${await h.run(child, "probe_read")}`
      }),
    )
    const helper = h.agentOf("helper", main)

    for (const agent of [main, helper]) {
      for (const tool of ["bash", "probe_read", "program", "subagent"]) {
        const text = await h.run(agent, tool)
        expect(text, tool).not.toContain(SECRET)
        expect(text, tool).toContain("[withheld]")
      }
    }
    expect(await h.run(h.agentOf("x", other), "bash")).toContain(SECRET)
    expect(await h.run(h.agentOf("x", other), "probe_read")).toContain(SECRET)
    expect(await h.run(h.agentOf("y", undefined), "bash")).toContain(SECRET)
    expect(await h.run(undefined, "bash")).toContain(SECRET)
  })
})

describe("the vault guard row on DSH's tool registry", () => {
  const LEAK = EXAMPLE.login.password
  const objectTool = (name: string, body: () => Promise<object>): ToolDefinition => ({
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    output: {
      schema: { type: "object" },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    execute: () => body(),
  })

  it("withholds a bot's secret from every tool's value and content, for that bot's Agents only", async () => {
    const account = await harness.addAccount()
    await harness.panel.grant(OWNER, "a", {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.login.itemId,
      kinds: ["password"],
      connectors: ["browser"],
    })
    const h = await host()
    h.tools.register(
      objectTool("bash", async () => ({ stdout: `cat secret.txt\n${LEAK}\n`, exitCode: 0 })),
    )
    h.tools.register(
      textTool("failing", async () => {
        throw new Error(`it says ${LEAK}`)
      }),
    )
    h.tools.register({
      ...objectTool("split", async () => ({ parts: [LEAK.slice(0, 8), LEAK.slice(8)] })),
      output: {
        schema: { type: "object" },
        render: (_args, value) => [
          { type: "text", text: (value as { parts: string[] }).parts.join("") },
        ],
      },
    })
    const bot = await h.mount([
      { id: "connector", name: "@test/connector" },
      {
        id: "env-bot-core-vault-guard",
        name: "@1outres/dsh-bot-core/vault-guard",
        config: { botId: "a", token: "sealed" },
      },
    ])
    const main = h.agentOf("main", bot)
    const helper = h.agentOf("helper", main)
    for (const agent of [main, helper]) {
      const result = await h.call(agent, "bash")
      expect(JSON.stringify(result)).not.toContain(LEAK)
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({
        stdout: expect.stringContaining("[withheld: secret of Example login (password)]"),
        exitCode: 0,
      })
      const split = await h.call(agent, "split")
      expect(split.isError).toBe(true)
      expect(JSON.stringify(split.content)).not.toContain(LEAK)
      expect(JSON.stringify(split.content)).toContain("[withheld")
      const failed = await h.call(agent, "failing")
      expect(failed.isError).toBe(true)
      expect(JSON.stringify(failed)).not.toContain(LEAK)
      const denied = await h.call(agent, "bash", { command: `echo ${LEAK}` })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied.content)).toContain("hold the secret of Example login")
    }
    const stranger = h.agentOf(
      "stranger",
      await h.mount([{ id: "connector", name: "@test/connector" }]),
    )
    expect(JSON.stringify((await h.call(stranger, "bash")).value)).toContain(LEAK)
    const counts = new Map<string, number>()
    for (const incident of harness.store.incidents("a")) {
      const key = `${incident.source}:${incident.outcome}`
      counts.set(key, (counts.get(key) ?? 0) + 1 + (incident.repeats ?? 0))
    }
    expect(counts.get("tool-result:redacted")).toBe(6)
    expect(counts.get("tool-arguments:exposed")).toBe(2)
  })

  it("blocks an outcome the guard cannot vouch for (an Agent not of the bot)", async () => {
    const h = await host()
    h.tools.register(objectTool("bash", async () => ({ stdout: "ok" })))
    const bot = await h.mount([
      {
        id: "env-bot-core-vault-guard",
        name: "@1outres/dsh-bot-core/vault-guard",
        config: { botId: "a", token: "sealed" },
      },
    ])
    const intruder = h.agentOf("intruder", bot)
    const result = await h.call(intruder, "bash")
    expect(result.isError).toBe(true)
  })
})
