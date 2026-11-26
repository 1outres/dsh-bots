import { Context, Service } from "@deepseek-ai/cordis"
import { agentEvents } from "@deepseek-ai/dsh-agent"
import type { SkillCandidate, SkillProvider, SkillProviderControl } from "@deepseek-ai/dsh-skill"
import { describe, expect, it, vi } from "vitest"
import {
  CALL_SKILL_TOOL,
  LIST_SKILLS,
  LOAD_SKILL,
  PREPARE_SKILLS,
  SKILL_TOOL_AVAILABLE,
  type SkillToolRequest,
  WATCH_SKILLS,
} from "../src/internal"
import BotSkills, { SKILL_PROVIDER } from "../src/plugins/skills"

const ENTRY = {
  name: "weekly-report",
  description: "Weekly.",
  directory: "/home/bot/workspace/skills/weekly-report",
}

class FakeBot extends Service {
  readonly calls: string[] = []
  listener: (() => void) | undefined
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  [SKILL_TOOL_AVAILABLE](_botId: string, _token: string, agentId: string) {
    return agentId === "main"
  }
  async [CALL_SKILL_TOOL](botId: string, token: string, request: SkillToolRequest) {
    this.calls.push(`call ${botId} ${token} ${request.agentId}`)
    return { text: "done" }
  }
  async [PREPARE_SKILLS](botId: string, token: string, agentId: string) {
    this.calls.push(`prepare ${botId} ${token} ${agentId}`)
  }
  async [LIST_SKILLS]() {
    return [ENTRY]
  }
  async [LOAD_SKILL](_botId: string, _token: string, name: string) {
    return name === ENTRY.name ? { ...ENTRY, content: "Steps." } : undefined
  }
  [WATCH_SKILLS](_botId: string, _token: string, listener: () => void) {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
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

class FakeSkills extends Service {
  provider: SkillProvider | undefined
  readonly invalidate = vi.fn()
  readonly control = new AbortController()
  constructor(ctx: Context) {
    super(ctx, "skills")
  }
  registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
    this.provider = create({ signal: this.control.signal, invalidate: this.invalidate })
    return () => this.control.abort()
  }
}

async function mounted() {
  const root = new Context()
  await root.plugin(FakeBot)
  await root.plugin(FakeTools)
  await root.plugin(FakeSkills)
  await root.plugin(BotSkills, { botId: "a", token: "t" })
  return {
    root,
    bot: root.get("bot") as unknown as FakeBot,
    tools: root.get("tools") as unknown as FakeTools,
    skills: root.get("skills") as unknown as FakeSkills,
  }
}

describe("@1outres/dsh-bot-core/skills", () => {
  it("provides the bot's skills/ and invalidates the catalog when they change", async () => {
    const { bot, skills } = await mounted()
    const provider = skills.provider
    expect(provider?.name).toBe(SKILL_PROVIDER)
    const candidates = await provider?.list({})
    expect(candidates).toEqual([
      {
        name: "weekly-report",
        description: "Weekly.",
        invocation: { modelInvocable: true, userInvocable: true },
        source: "bot-workspace",
        provider: SKILL_PROVIDER,
        resourceBase: { kind: "directory", path: ENTRY.directory },
        rank: 100,
        locator: "weekly-report",
      },
    ])
    const [candidate] = candidates as SkillCandidate[]
    expect(await provider?.get(candidate as SkillCandidate, {})).toMatchObject({
      name: "weekly-report",
      content: "Steps.",
    })
    bot.listener?.()
    expect(skills.invalidate).toHaveBeenCalledOnce()
    skills.control.abort()
    expect(bot.listener).toBeUndefined()
  })

  it("registers skill_manage where the service shows it, and passes calls with the revision's token", async () => {
    const { bot, tools } = await mounted()
    const [tool] = tools.registered
    expect(tool?.definition.name).toBe("skill_manage")
    expect(tool?.options.when({ agent: { id: "main" } })).toBe(true)
    expect(tool?.options.when({ agent: { id: "run" } })).toBe(false)
    expect(
      await tool?.definition.execute(
        { action: "list" },
        { agent: { id: "main" }, signal: new AbortController().signal },
      ),
    ).toEqual({
      text: "done",
    })
    expect(bot.calls).toEqual(["call a t main"])
  })

  it("reads skills/ again before the rest of the step", async () => {
    const { root, bot } = await mounted()
    const inner = vi.fn(async () => {
      bot.calls.push("catalog")
      return { kind: "enter" as const, messages: [] }
    })
    await agentEvents(root, { id: "main" } as never).waterfall(
      "agent/pre-step",
      {
        messages: [],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: {} as never,
      },
      inner,
    )
    expect(bot.calls).toEqual(["prepare a t main", "catalog"])
  })
})
