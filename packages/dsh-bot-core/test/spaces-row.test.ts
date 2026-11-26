import { Context, Service } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import { SPACE_TOOL_NAMES } from "../src/host/spaces/texts"
import { CALL_SPACE_TOOL, SPACE_TOOLS_AVAILABLE, type SpaceToolCall } from "../src/internal"
import BotSpacesTools from "../src/plugins/spaces"

class FakeBot extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  [SPACE_TOOLS_AVAILABLE](_botId: string, _token: string, agentId: string) {
    return agentId === "main"
  }
  async [CALL_SPACE_TOOL](botId: string, token: string, request: SpaceToolCall) {
    this.calls.push(
      `${botId} ${token} ${request.agentId} ${request.tool} ${JSON.stringify(request.args)}`,
    )
    return { text: "done" }
  }
}

interface Registered {
  readonly definition: { name: string; execute(args: unknown, exec: object): Promise<unknown> }
  readonly options: { when(context: { agent: { id: string } }): boolean }
}

class FakeTools extends Service {
  readonly registered: Registered[] = []
  constructor(ctx: Context) {
    super(ctx, "tools")
  }
  register(definition: Registered["definition"], options: Registered["options"]) {
    this.registered.push({ definition, options })
    return () => {}
  }
}

describe("@1outres/dsh-bot-core/spaces", () => {
  it("registers every space tool for the Agents the bot service offers them to", async () => {
    const root = new Context()
    await root.plugin(FakeBot)
    await root.plugin(FakeTools)
    await root.plugin(BotSpacesTools, { botId: "a", token: "t" })
    const tools = root.get("tools") as unknown as FakeTools
    const service = root.get("bot") as unknown as FakeBot
    expect(tools.registered.map((tool) => tool.definition.name)).toEqual([...SPACE_TOOL_NAMES])
    const publish = tools.registered.find(
      (tool) => tool.definition.name === "space_publish",
    ) as Registered
    expect(publish.options.when({ agent: { id: "main" } })).toBe(true)
    expect(publish.options.when({ agent: { id: "run" } })).toBe(false)
    expect(
      await publish.definition.execute(
        { space: "demo" },
        { agent: { id: "main" }, signal: new AbortController().signal },
      ),
    ).toEqual({ text: "done" })
    expect(service.calls).toEqual(['a t main space_publish {"space":"demo"}'])
    await expect(
      publish.definition.execute({ space: "demo" }, { signal: new AbortController().signal }),
    ).rejects.toThrow("requires the calling Agent")
  })
})
