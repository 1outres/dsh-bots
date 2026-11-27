import { Context, Service } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import { type ChannelSilenceRequest, STAY_CHANNEL_SILENT } from "../src/internal"
import BotChannelTools from "../src/plugins/channel"

class FakeBot extends Service {
  readonly calls: string[] = []
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  [STAY_CHANNEL_SILENT](botId: string, token: string, request: ChannelSilenceRequest) {
    this.calls.push(`${botId} ${token} ${request.agentId}`)
    if (request.agentId !== "main") throw new Error("only the Main session can stay silent")
    return { turn: 2 }
  }
}

interface Registered {
  readonly name: string
  execute(args: unknown, exec: object): Promise<unknown>
}

class FakeTools extends Service {
  readonly registered: Registered[] = []
  constructor(ctx: Context) {
    super(ctx, "tools")
  }
  register(definition: Registered) {
    this.registered.push(definition)
    return () => {}
  }
}

async function setup() {
  const root = new Context()
  await root.plugin(FakeBot)
  await root.plugin(FakeTools)
  await root.plugin(BotChannelTools, { botId: "a", token: "t" })
  const [tool] = (root.get("tools") as unknown as FakeTools).registered as [Registered]
  const bot = root.get("bot") as unknown as FakeBot
  const run = (agentId: string) => {
    const conclusions: string[] = []
    const result = tool.execute(
      {},
      {
        agent: { id: agentId },
        signal: new AbortController().signal,
        concludeTurn: () => conclusions.push(agentId),
      },
    )
    return { result, conclusions }
  }
  return { tool, bot, run }
}

describe("@1outres/dsh-bot-core/channel stay_silent", () => {
  it("silences the running turn with the revision's token and ends the turn", async () => {
    const { tool, bot, run } = await setup()
    expect(tool.name).toBe("stay_silent")
    const { result, conclusions } = run("main")
    expect(await result).toEqual({ turn: 2 })
    expect(bot.calls).toEqual(["a t main"])
    expect(conclusions).toEqual(["main"])
  })

  it("leaves the turn running when the call is refused", async () => {
    const { run } = await setup()
    const { result, conclusions } = run("other")
    await expect(result).rejects.toThrow("only the Main session")
    expect(conclusions).toEqual([])
  })
})
