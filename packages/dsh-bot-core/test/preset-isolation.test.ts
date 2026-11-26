import { describe, expect, it } from "vitest"
import { BotIsolationError, createIsolation, type ToolEntry } from "../src/host/preset/isolation"

interface FakeAgent {
  id: string
  preset: string | undefined
  bot: string | undefined
  unverified?: string
  parent?: FakeAgent
  presetTools: ToolEntry[]
  own: ToolEntry[]
  masks: Set<readonly string[]>
  guards: Set<(tool: string) => string | undefined>
  inactive?: boolean
}

const tool = (name: string): ToolEntry => ({ name })

interface Options {
  hostTools?: Record<string, string[] | undefined>
  failRestrict?: boolean
}

function setup(options: Options = {}) {
  const globals: ToolEntry[] = ["ask", "team_task", "working_directory"].map(tool)
  const bots = new Set(["a", "b"])
  const registrations: Record<string, { revision: string; hostTools: string[] } | undefined> = {}
  for (const [botId, hostTools] of Object.entries(options.hostTools ?? { a: ["ask"], b: [] })) {
    registrations[botId] =
      hostTools === undefined ? undefined : { revision: `r1-${botId}`, hostTools }
  }
  const agents: FakeAgent[] = []
  const warnings: string[] = []
  let failRestrict = options.failRestrict === true
  let restricts = 0
  let onRestrict: () => void = () => {}
  const visibleTools = (agent: FakeAgent): ToolEntry[] => {
    const hidden = new Set([...agent.masks].flat())
    const inherited = new Map(globals.map((entry) => [entry.name, entry]))
    for (const entry of agent.presetTools) inherited.set(entry.name, entry)
    const seen = [...inherited.values()].filter((entry) => !hidden.has(entry.name))
    return [...seen, ...agent.own]
  }
  const isolation = createIsolation<FakeAgent>({
    presetOf: (agent) => agent.preset,
    sessionOf: (agent) =>
      agent.unverified !== undefined
        ? { kind: "unverified", reason: agent.unverified }
        : agent.bot === undefined
          ? { kind: "none" }
          : { kind: "bot", botId: agent.bot },
    isBot: (botId) => bots.has(botId),
    registration: (botId) => registrations[botId],
    parentOf: (agent) => agent.parent,
    globalTools: () => globals,
    visibleTools,
    restrict: (agent, deny) => {
      if (agent.inactive) throw Object.assign(new Error("inactive"), { code: "INACTIVE_EFFECT" })
      if (failRestrict) throw new Error("restrict failed")
      const known = new Set([...globals, ...agent.presetTools].map((entry) => entry.name))
      const unknown = deny.filter((name) => !known.has(name))
      if (unknown.length > 0) throw new Error(`names unknown global tools ${unknown.join(", ")}`)
      const mask = [...deny]
      agent.masks.add(mask)
      restricts += 1
      onRestrict()
      return () => {
        agent.masks.delete(mask)
      }
    },
    guard: (agent, guard) => {
      agent.guards.add(guard)
      return () => agent.guards.delete(guard)
    },
    agents: () => agents,
    label: (agent) => agent.id,
    warn: (message) => warnings.push(message),
  })
  const agent = (
    id: string,
    preset: string | undefined,
    bot: string | undefined,
    presetTools: string[] = ["read", "bash"],
  ): FakeAgent => {
    const created: FakeAgent = {
      id,
      preset,
      bot,
      presetTools: presetTools.map(tool),
      own: [],
      masks: new Set(),
      guards: new Set(),
    }
    agents.push(created)
    return created
  }
  const hidden = (agent: FakeAgent) => [...new Set([...agent.masks].flat())].sort()
  const visible = (agent: FakeAgent) => visibleTools(agent).map((entry) => entry.name)
  const runs = (agent: FakeAgent, name: string) =>
    [...agent.guards].every((guard) => guard(name) === undefined)
  return {
    isolation,
    globals,
    registrations,
    agents,
    agent,
    hidden,
    visible,
    runs,
    warnings,
    restricts: () => restricts,
    setFail: (value: boolean) => {
      failRestrict = value
    },
    setOnRestrict: (fn: () => void) => {
      onRestrict = fn
    },
  }
}

describe("createIsolation: bot Agents", () => {
  it("hides and refuses every global tool but the host tools; own tools run", () => {
    const { isolation, agent, hidden, visible, runs } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    expect(hidden(bot)).toEqual(["team_task", "working_directory"])
    expect(visible(bot)).toEqual(["ask", "read", "bash"])
    expect(runs(bot, "team_task")).toBe(false)
    expect(runs(bot, "ask")).toBe(true)
    expect(runs(bot, "read")).toBe(true)
    expect(runs(bot, "run_code")).toBe(true)
    expect(isolation.verdict(bot)).toMatchObject({ kind: "bot", botId: "a" })
  })

  it("leaves Workspace Agents alone: no mask, no guard", () => {
    const { isolation, agent, restricts } = setup()
    const workspace = agent("s1", "standard", undefined)
    isolation.created(workspace)
    isolation.created(agent("s2", undefined, undefined))
    isolation.created(agent("s3", "bot-zz", undefined))
    expect(restricts()).toBe(0)
    expect(workspace.guards.size).toBe(0)
  })

  it("does not mask or refuse a preset tool that shares a global tool's name", () => {
    const { isolation, agent, hidden, visible, runs } = setup({ hostTools: { a: [] } })
    const bot = agent("s1", "bot-a", "a", ["read", "working_directory"])
    isolation.created(bot)
    expect(hidden(bot)).toEqual(["ask", "team_task"])
    expect(visible(bot)).toContain("working_directory")
    expect(runs(bot, "working_directory")).toBe(true)
  })

  it("never names an Agent's own-scope tool in a mask (structured-output subagents)", () => {
    const { isolation, agent, visible, runs, warnings } = setup()
    const child = agent("c1", "standard", "a")
    child.own.push(tool("return_result"))
    isolation.created(child)
    expect(visible(child)).toEqual(["read", "bash", "return_result"])
    expect(runs(child, "return_result")).toBe(false)
    child.own.push(tool("another"))
    isolation.resync()
    expect(warnings.filter((message) => message.includes("could not update"))).toEqual([])
  })

  it("installs no mask when every global tool is allowed", () => {
    const { isolation, agent, restricts } = setup({
      hostTools: { a: ["ask", "team_task", "working_directory"] },
    })
    isolation.created(agent("s1", "bot-a", "a"))
    expect(restricts()).toBe(0)
  })

  it("allows no Host tool while the bot's preset is not registered", () => {
    const { isolation, agent, hidden, runs } = setup({ hostTools: { a: undefined } })
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    expect(hidden(bot)).toEqual(["ask", "team_task", "working_directory"])
    expect(runs(bot, "ask")).toBe(false)
  })

  it("pins the host tools of the revision an Agent started with; a subagent shares its parent's", () => {
    const { isolation, agent, hidden, registrations } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    registrations.a = { revision: "r2", hostTools: ["ask", "working_directory"] }
    isolation.resync()
    expect(hidden(bot)).toEqual(["team_task", "working_directory"])
    const child = agent("c1", "bot-a", "a")
    child.parent = bot
    isolation.created(child)
    expect(hidden(child)).toEqual(["team_task", "working_directory"])
    const fresh = agent("s2", "bot-a", "a")
    isolation.created(fresh)
    expect(hidden(fresh)).toEqual(["team_task"])
    registrations.a = undefined
    isolation.resync()
    expect(hidden(bot)).toEqual(["ask", "team_task", "working_directory"])
    registrations.a = { revision: "r2", hostTools: ["ask", "working_directory"] }
    isolation.resync()
    expect(hidden(bot)).toEqual(["team_task", "working_directory"])
  })
})

describe("createIsolation: identity", () => {
  it("locks down an unverified session, whatever preset it runs", () => {
    const { isolation, agent, runs } = setup()
    const onBot = agent("c1", "bot-a", undefined)
    onBot.unverified = "its delegating Agent is not running"
    isolation.created(onBot)
    expect(isolation.verdict(onBot)).toEqual({
      kind: "lockdown",
      reason: "its delegating Agent is not running",
    })
    expect(runs(onBot, "read")).toBe(false)
    const onOther = agent("c2", "standard", undefined)
    onOther.unverified = "unknown"
    isolation.created(onOther)
    expect(isolation.verdict(onOther)).toMatchObject({ kind: "lockdown" })
  })

  it("locks down a bot preset outside its bot's sessions", () => {
    const { isolation, agent, hidden, runs, warnings } = setup()
    const stray = agent("s1", "bot-a", undefined)
    isolation.created(stray)
    expect(hidden(stray)).toEqual(["ask", "team_task", "working_directory"])
    expect(runs(stray, "read")).toBe(false)
    expect(runs(stray, "run_code")).toBe(false)
    expect(isolation.verdict(stray)).toMatchObject({ kind: "lockdown" })
    expect(warnings).toEqual([expect.stringContaining("outside that bot's sessions")])
  })

  it("locks down another preset in a bot's session (picker, explicit subagent preset, another bot's preset)", () => {
    const { isolation, agent, runs } = setup()
    const picked = agent("s1", "standard", "a", ["read", "bash", "web_fetch"])
    isolation.created(picked)
    expect(runs(picked, "web_fetch")).toBe(false)
    const otherBot = agent("s2", "bot-b", "a")
    isolation.created(otherBot)
    expect(isolation.verdict(otherBot)).toMatchObject({ kind: "lockdown" })
  })

  it("locks down a legacy Main (default preset) recorded as its bot's", () => {
    const { isolation, agent, runs } = setup()
    const main = agent("main-a", "standard", "a")
    isolation.created(main)
    expect(isolation.verdict(main)).toMatchObject({ kind: "lockdown" })
    expect(runs(main, "read")).toBe(false)
  })

  it("locks down a bot Agent an earlier bot-core pinned to a revision before environments", () => {
    const { isolation, agent, runs } = setup()
    const old = agent("s-old", "bot-a", "a")
    isolation.created(old)
    const record = Reflect.get(old, Symbol.for("@1outres/dsh-bot-core/isolation")) as {
      pin?: { preset: string; revision: string; hostTools: ReadonlySet<string>; environment?: true }
    }
    expect(record.pin?.environment).toBe(true)
    record.pin = { preset: "bot-a", revision: "old", hostTools: new Set(["ask"]) }
    isolation.resync()
    expect(isolation.verdict(old)).toMatchObject({
      kind: "lockdown",
      reason: expect.stringContaining("before bot environments"),
    })
    expect(runs(old, "read")).toBe(false)
    const fresh = agent("s-new", "bot-a", "a")
    isolation.created(fresh)
    expect(isolation.verdict(fresh)).toMatchObject({ kind: "bot" })
  })

  it("follows a preset switch: bot → foreign → bot, overrides intact", () => {
    const { isolation, agent, visible, runs } = setup({ hostTools: { a: [] } })
    const live = agent("s1", "bot-a", "a", ["read", "working_directory"])
    isolation.created(live)
    live.preset = "standard"
    live.presetTools = ["read", "web_fetch"].map(tool)
    isolation.resync()
    expect(runs(live, "read")).toBe(false)
    live.preset = "bot-a"
    live.presetTools = ["read", "working_directory"].map(tool)
    isolation.resync()
    expect(visible(live)).toEqual(["working_directory", "read"])
    expect(runs(live, "working_directory")).toBe(true)
    expect(live.guards.size).toBe(1)
  })
})

describe("createIsolation: life cycle", () => {
  it("fails closed: refuses an Agent it cannot mask", () => {
    const { isolation, agent } = setup({ failRestrict: true })
    expect(() => isolation.created(agent("s1", "bot-a", "a"))).toThrow(BotIsolationError)
    expect(() => isolation.created(agent("s2", "standard", "a"))).toThrow(BotIsolationError)
    expect(() => isolation.created(agent("s3", "standard", undefined))).not.toThrow()
  })

  it("re-derives the mask when global tools change, without a gap", () => {
    const { isolation, agent, hidden, globals, runs } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    globals.push(tool("late_tool"))
    expect(runs(bot, "late_tool")).toBe(false)
    isolation.resync()
    expect(hidden(bot)).toEqual(["late_tool", "team_task", "working_directory"])
    expect(bot.masks.size).toBe(1)
  })

  it("does nothing on a resync that changes nothing", () => {
    const { isolation, agent, restricts } = setup()
    isolation.created(agent("s1", "bot-a", "a"))
    isolation.resync()
    isolation.resync()
    expect(restricts()).toBe(1)
  })

  it("masks a locked-down Agent once, not twice per change", () => {
    const { isolation, agent, restricts, setOnRestrict } = setup()
    setOnRestrict(() => isolation.resync())
    isolation.created(agent("s1", "standard", "a"))
    expect(restricts()).toBe(1)
  })

  it("keeps the previous mask when re-deriving fails, and reports it", () => {
    const { isolation, agent, hidden, globals, setFail, warnings } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    setFail(true)
    globals.push(tool("late_tool"))
    isolation.resync()
    expect(hidden(bot)).toEqual(["team_task", "working_directory"])
    expect(warnings).toEqual([expect.stringContaining("previous mask and guard stay")])
  })

  it("skips an Agent that is tearing down, silently", () => {
    const { isolation, agent, globals, warnings } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    bot.inactive = true
    globals.push(tool("late_tool"))
    isolation.resync()
    expect(warnings).toEqual([])
  })

  it("settles the tools/change echo of its own restrict", () => {
    const { isolation, agent, setOnRestrict, restricts } = setup()
    setOnRestrict(() => isolation.resync())
    isolation.created(agent("s1", "bot-a", "a"))
    agent("s2", "bot-a", "a")
    isolation.resync()
    expect(restricts()).toBe(2)
  })

  it("does not drop a real change that arrives while a pass runs", () => {
    const { isolation, agent, hidden, globals, setOnRestrict } = setup()
    const first = agent("s1", "bot-a", "a")
    setOnRestrict(() => {
      if (!globals.some((entry) => entry.name === "late_tool")) {
        globals.push(tool("late_tool"))
        isolation.resync()
      }
    })
    isolation.created(first)
    expect(hidden(first)).toEqual(["late_tool", "team_task", "working_directory"])
  })

  it("keeps guard and mask after dispose, with the last verdict", () => {
    const { isolation, agent, hidden, runs, globals } = setup()
    const bot = agent("s1", "bot-a", "a")
    isolation.created(bot)
    isolation.dispose()
    globals.push(tool("late_tool"))
    expect(hidden(bot)).toEqual(["team_task", "working_directory"])
    expect(runs(bot, "late_tool")).toBe(false)
    expect(runs(bot, "ask")).toBe(true)
  })

  it("takes over the guard and mask of an earlier load instead of adding its own", () => {
    const first = setup()
    const bot = first.agent("s1", "bot-a", "a")
    first.isolation.created(bot)
    first.isolation.dispose()
    const second = setup({ hostTools: { a: ["ask", "working_directory"] } })
    second.agents.push(bot)
    second.isolation.resync()
    expect(bot.guards.size).toBe(1)
    expect(bot.masks.size).toBe(1)
    expect(second.hidden(bot)).toEqual(["team_task", "working_directory"])
  })

  it("lifts its mask and lets the guard pass once an Agent is in order again", () => {
    const { isolation, agent, hidden, runs } = setup()
    const live = agent("s1", "standard", "a")
    isolation.created(live)
    live.bot = undefined
    isolation.resync()
    expect(hidden(live)).toEqual([])
    expect(runs(live, "read")).toBe(true)
  })
})
