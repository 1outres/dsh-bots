import { Context, Service } from "@deepseek-ai/cordis"
import { EntryTree, Group, Loader } from "@deepseek-ai/cordis-plugin-loader"
import { agentEvents } from "@deepseek-ai/dsh-agent"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import { bindScopeParent, createScope } from "@deepseek-ai/dsh-scope"
import {
  PERSONA_PREFIX_SECTION,
  type PromptAssembly,
  renderContextSnapshot,
  renderPrompt,
  SystemPrompt,
} from "@deepseek-ai/dsh-system-prompt"
import { describe, expect, it } from "vitest"
import { createBotNotes } from "../src/host/notes/bot-notes"
import { createInitialNotes } from "../src/host/notes/initial"
import { createNoteTools } from "../src/host/notes/tools"
import { composeBotPreset } from "../src/host/preset/compose"
import { DEFAULT_PERSONA } from "../src/host/preset/default-template"
import {
  type BotManagementFacts,
  type BotPromptFacts,
  type BotSessionKind,
  type BotStatusFacts,
  CALL_NOTE_TOOL,
  DESCRIBE_PROMPT,
  type NoteStepRequest,
  type NoteToolRequest,
  PINNED_NOTES,
  PREPARE_NOTES,
} from "../src/internal"
import BotNotes from "../src/plugins/notes"
import BotPrompt from "../src/plugins/prompt"
import type { PluginRow } from "../src/shared/preset"
import { BOT_PROMPT_EXCLUSIONS } from "../src/shared/prompt"
import { idMaker, memoryNotesFs } from "./support/notes-fs"

const STATUS: BotStatusFacts = {
  channels: [
    {
      name: "Discord",
      status: { state: "connected", account: "Mia#0001" },
      owners: ["123456789012345678"],
    },
  ],
  connectors: [
    {
      name: "Gmail",
      readiness: { state: "ready", since: 1 },
      accounts: ["you@example.com"],
    },
    {
      name: "Desktop",
      readiness: { state: "preparing", since: 1, stage: { kind: "queued", since: 1 } },
      accounts: [],
    },
  ],
  web: {
    search: { state: "ready", backend: "exa" },
    fetch: { state: "ready", backend: "exa" },
  },
}

const DISCORD_HINT =
  "Markdown renders, tables do not; wrap a link in <> to keep it from expanding into a preview."

const SESSIONS: Readonly<Record<string, BotSessionKind>> = {
  "session-main": "main",
  "session-web": "web",
  "session-entrusted": "web",
  "session-delegated": "delegated",
  "session-schedule": "schedule",
  "session-helper": "subagent",
  "session-curator": "curator",
}

const MANAGED: Readonly<Record<string, BotManagementFacts>> = {
  "session-delegated": { answerer: "main" },
  "session-entrusted": { answerer: "owner" },
}

const liveAgent = (id: string) => ({
  id,
  session: {
    header:
      id === "session-helper" || id === "session-curator" ? { parentSession: "session-main" } : {},
  },
})

function botNotes() {
  const fs = memoryNotesFs()
  const place = { fs, workspace: "/home/bot/workspace" }
  const newId = idMaker()
  const notes = createBotNotes({
    sealed: (botId, token) => botId === "a" && token === "sealed",
    agent: (agentId) => (SESSIONS[agentId] === undefined ? undefined : liveAgent(agentId)),
    botOf: () => "a",
    kind: {
      isMain: (_botId, sessionId) => sessionId === "session-main",
      isScheduleRun: (_botId, sessionId) => sessionId === "session-schedule",
      isRecorded: (_botId, sessionId) =>
        sessionId !== "session-helper" && sessionId !== "session-curator",
      reviewed: () => undefined,
      curating: (_botId, sessionId) => sessionId === "session-curator",
      isStartedByMain: (_botId, sessionId) => sessionId === "session-delegated",
    },
    placeOf: () => place,
    tools: createNoteTools({ newId }),
    shield: async (_botId, text) => text,
  })
  const initial = createInitialNotes({
    placeOf: () => place,
    withNotes: (botId, work) => notes.withNotes(botId, work),
    newId,
    version: 1,
    placed: () => false,
    mark: async () => {},
  })
  return { notes, initial, fs }
}

class FakeBot extends Service {
  readonly asked: string[] = []
  status: BotStatusFacts = STATUS
  readonly memory = botNotes()
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  [PINNED_NOTES](botId: string, token: string, agentId: string): string {
    return this.memory.notes.pinned(botId, token, agentId)
  }
  [PREPARE_NOTES](botId: string, token: string, request: NoteStepRequest, signal: AbortSignal) {
    return this.memory.notes.prepare(botId, token, request, signal)
  }
  [CALL_NOTE_TOOL](botId: string, token: string, request: NoteToolRequest, signal: AbortSignal) {
    return this.memory.notes.call(botId, token, request, signal)
  }
  [DESCRIBE_PROMPT](botId: string, token: string, agentId: string): BotPromptFacts {
    this.asked.push(`${botId} ${token} ${agentId}`)
    const session = SESSIONS[agentId]
    if (botId !== "a" || token !== "sealed" || session === undefined) {
      throw new Error(`not an Agent of bot "${botId}"`)
    }
    const management = MANAGED[agentId]
    return {
      botName: "Mia",
      session,
      ...(management === undefined ? {} : { management }),
      channels: [{ name: "Discord", formatHint: DISCORD_HINT }],
      logins: false,
      status: this.status,
    }
  }
}

class FakeTools extends Service {
  readonly registered = new Set<string>()
  constructor(ctx: Context) {
    super(ctx, "tools")
  }
  register(definition: { name: string }) {
    this.registered.add(definition.name)
    return () => this.registered.delete(definition.name)
  }
}

class Persona {
  static inject = ["systemPrompt"]
  constructor(ctx: Context, config: { prefix: string }) {
    ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: 0, text: config.prefix })
  }
}

const modules: Record<string, unknown> = {
  "cordis:group": Group,
  "@1outres/dsh-bot-core/prompt": BotPrompt,
  "@1outres/dsh-bot-core/notes": BotNotes,
  "@1outres/dsh-bot-core/files": { name: "files", apply() {} },
  "@1outres/dsh-bot-core/channel": { name: "channel", apply() {} },
  "@1outres/dsh-bot-core/connectors": { name: "connectors", apply() {} },
  "@1outres/dsh-bot-core/schedule": { name: "schedule", apply() {} },
  "@1outres/dsh-bot-core/sessions": { name: "sessions", apply() {} },
  "@1outres/dsh-bot-core/web": { name: "web", apply() {} },
  "@1outres/dsh-bot-core/vaults": { name: "vaults", apply() {} },
  "@1outres/dsh-bot-core/vault-guard": { name: "vault-guard", apply() {} },
  "@1outres/dsh-bot-core/skills": { name: "skills", apply() {} },
  "@1outres/dsh-bot-core/conversations": { name: "conversations", apply() {} },
  "@deepseek-ai/dsh-skill": { name: "dsh-skill", apply() {} },
  "@deepseek-ai/dsh-web": { name: "dsh-web", apply() {} },
  "@deepseek-ai/dsh-persona": Persona,
  "@test/env-fs": { name: "env-fs", apply() {} },
  "@test/tool": { name: "tool", apply() {} },
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

const botRows = (): readonly PluginRow[] => {
  const composed = composeBotPreset({
    botId: "a",
    botName: "Mia",
    template: {
      id: "t",
      plugins: [
        { id: "persona", name: "@deepseek-ai/dsh-persona", config: { prefix: DEFAULT_PERSONA } },
        { id: "tool", name: "@test/tool" },
      ],
    },
    overlay: [],
    environment: {
      id: "vm",
      isolate: ["fs"],
      rows: [{ id: "env-fs", name: "@test/env-fs" }],
    },
    allowedHostTools: new Set(),
    web: { backend: "exa", search: true, fetch: true },
    seal: () => "sealed",
  })
  if (!composed.ok) throw new Error(composed.problem)
  return composed.preset.plugins
}

async function host() {
  const root = new Context()
  await root.plugin(TestLoader)
  await root.plugin(SystemPrompt, {})
  await root.plugin(FakeBot)
  await root.plugin(FakeTools)
  const prompt = root.get("systemPrompt") as unknown as SystemPrompt
  const bot = root.get("bot") as unknown as FakeBot
  const tools = root.get("tools") as unknown as FakeTools
  await bot.memory.initial.ensure("a", new AbortController().signal)
  await bot.memory.notes.prepare(
    "a",
    "sealed",
    { agentId: "session-main", messages: [] },
    new AbortController().signal,
  )
  prompt.variable("model", () => "deepseek-v4")
  let owner: Context | undefined
  await root.plugin({
    name: "agent-presets",
    inject: ["loader"],
    apply(ctx: Context) {
      owner = ctx
    },
  })
  const registry = owner as Context
  const names = new Set([...BOT_PROMPT_EXCLUSIONS.sections, ...BOT_PROMPT_EXCLUSIONS.contexts])
  for (const [order, name] of [...names, "kept"].entries()) {
    prompt.section({ name, order, text: `section ${name}` })
    prompt.context({ name, order, text: `context ${name}` })
  }
  const mount = async (rows: readonly PluginRow[]) => {
    const key = {}
    const scope = createScope(registry, key)
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
  const assemble = (agent: { id: string } | undefined): Promise<PromptAssembly> =>
    prompt.assemble(agent === undefined ? {} : ({ scope: agent, agent } as never))
  const names_ = async (agent: { id: string } | undefined) => {
    const assembly = await assemble(agent)
    return {
      sections: assembly.sections.map((section) => section.name),
      contexts: assembly.contexts.map((context) => context.name),
    }
  }
  const preStep = (agent: { id: string }, text: string) => {
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    })
    return agentEvents(root, agent as never).waterfall(
      "agent/pre-step",
      {
        messages: [message],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: {} as never,
      },
      async () => ({ kind: "enter" as const, messages: [message] }),
    )
  }
  return { bot, tools, mount, agentOf, assemble, preStep, names: names_ }
}

const EVERYTHING = [
  "harness:source",
  "app:web-surface",
  "ui:deliverable-file-references",
  "sandbox:policy",
  "approval:policy",
  "kept",
]

describe("@1outres/dsh-bot-core/prompt in a bot preset", () => {
  it("adds bot-core's prompt and removes the exclusions for the bot preset's Agents only", async () => {
    const h = await host()
    const bot = await h.mount(botRows())
    const other = await h.mount([{ id: "tool", name: "@test/tool" }])
    const all = await h.names(undefined)
    expect(all).toMatchObject({ sections: expect.arrayContaining(EVERYTHING) })
    expect(all.sections).not.toContain("bot:session")

    const main = h.agentOf("session-main", bot)
    const helper = h.agentOf("session-helper", main)
    for (const agent of [main, helper]) {
      const assembly = await h.names(agent)
      expect(assembly.sections).toEqual([
        "harness:identity",
        "deployment:persona-prefix",
        "sandbox:policy",
        "approval:policy",
        "kept",
        "bot:principles",
        "bot:environment",
        "bot:session",
        "bot:managed-sessions",
        "bot:messages",
        "bot:workspace-files",
        "bot:memory",
        "bot:conversations",
        "bot:skills",
        "deployment:persona-suffix",
      ])
      expect(assembly.contexts).toEqual([
        ...all.contexts.filter((name) => !BOT_PROMPT_EXCLUSIONS.contexts.includes(name)),
        "bot:status",
        "bot:pinned-notes",
        "bot:management",
        "bot:logins",
      ])
    }

    for (const agent of [
      h.agentOf("session-other", other),
      h.agentOf("session-none", undefined),
      undefined,
    ]) {
      expect(await h.names(agent)).toEqual(all)
    }
    expect(h.bot.asked.every((entry) => entry.startsWith("a sealed session-"))).toBe(true)
    expect([...h.tools.registered].sort()).toEqual([
      "note_link",
      "note_read",
      "note_search",
      "note_write",
    ])
  })

  it("adds the notice of the notes an owner's message names, for the bot's Agents only", async () => {
    const h = await host()
    const bot = await h.mount(botRows())
    const other = await h.mount([{ id: "tool", name: "@test/tool" }])
    await h.bot.memory.notes.call(
      "a",
      "sealed",
      {
        agentId: "session-main",
        tool: "note_write",
        args: { action: "create", title: "渋谷", type: "place", summary: "オーナーの職場がある" },
      },
      new AbortController().signal,
    )
    const decision = await h.preStep(h.agentOf("session-main", bot), "明日は渋谷で会おう")
    expect(decision.kind === "enter" && decision.messages.map((message) => message.source)).toEqual(
      [{ kind: "user" }, { kind: "bot-notes", form: "notice", summary: "Notes mentioned: 渋谷" }],
    )
    const notice = decision.kind === "enter" ? decision.messages[1] : undefined
    expect(notice?.content).toEqual([
      {
        type: "text",
        text: 'Notes that may be relevant to this message (read them with note_read if they help):\n- "渋谷" → 渋谷 (place — オーナーの職場がある)',
      },
    ])
    const stranger = await h.preStep(
      h.agentOf("session-main", bot),
      "[Discord · DM · Eve (@eve)]\n渋谷はどう？",
    )
    expect(stranger.kind === "enter" && stranger.messages).toHaveLength(1)
    const owner = await h.preStep(
      h.agentOf("session-main", bot),
      "[Discord · DM · Alice (@alice, owner)]\n渋谷はどう？",
    )
    expect(owner.kind === "enter" && owner.messages).toHaveLength(2)
    const elsewhere = await h.preStep(h.agentOf("session-other", other), "渋谷")
    expect(elsewhere.kind === "enter" && elsewhere.messages).toHaveLength(1)
    const schedule = await h.preStep(h.agentOf("session-schedule", bot), "渋谷")
    expect(schedule.kind === "enter" && schedule.messages).toHaveLength(1)
  })

  it("puts a pinned note's new text in the context of the next assembly, not in the system prompt", async () => {
    const h = await host()
    const bot = await h.mount(botRows())
    const main = h.agentOf("session-main", bot)
    const before = await h.assemble(main)
    expect(renderContextSnapshot(before)).toContain("## Owner (person)")
    const owner = [...h.bot.memory.fs.files.entries()].find(([, file]) =>
      file.text.includes("title: Owner"),
    )
    if (owner === undefined) throw new Error("no Owner note")
    h.bot.memory.fs.put(owner[0], owner[1].text.replace("title: Owner", "title: 花子さん"))
    await h.preStep(main, "こんにちは")
    const after = await h.assemble(main)
    expect(renderPrompt(after)).toBe(renderPrompt(before))
    expect(renderContextSnapshot(after)).toContain("## 花子さん (person)")
  })

  it("fails the assembly of an Agent the bot service does not know as the bot's", async () => {
    const h = await host()
    const bot = await h.mount(botRows())
    await expect(h.assemble(h.agentOf("session-stranger", bot))).rejects.toThrow("not an Agent")
  })

  describe("the prompt of each kind of session", () => {
    for (const agentId of Object.keys(SESSIONS)) {
      it(`${SESSIONS[agentId]}: ${agentId}`, async () => {
        const h = await host()
        const bot = await h.mount(botRows())
        const parent = agentId === "session-helper" ? h.agentOf("session-main", bot) : bot
        const assembly = await h.assemble(h.agentOf(agentId, parent))
        const own = {
          ...assembly,
          sections: assembly.sections.filter((section) => !EVERYTHING.includes(section.name)),
          contexts: assembly.contexts.filter((context) => !EVERYTHING.includes(context.name)),
        }
        expect(renderPrompt(own)).toMatchSnapshot("system prompt")
        expect(renderContextSnapshot(own)).toMatchSnapshot("runtime context")
      })
    }
  })

  it("keeps the system prompt when the status changes, and says so in the context", async () => {
    const h = await host()
    const bot = await h.mount(botRows())
    const main = h.agentOf("session-main", bot)
    const before = await h.assemble(main)
    h.bot.status = {
      ...STATUS,
      channels: [{ name: "Discord", status: { state: "connecting" }, owners: [] }],
      connectors: [],
      web: {
        search: { state: "disabled" },
        fetch: { state: "missing-secrets", backend: "exa", keys: ["apiKey"] },
      },
    }
    const after = await h.assemble(main)
    expect(renderPrompt(after)).toBe(renderPrompt(before))
    expect(renderContextSnapshot(after)).toContain(
      "- Chat channels: Discord (connecting; no owner listed: nobody there can instruct you as your owner)",
    )
    expect(renderContextSnapshot(after)).toContain("- Connectors: none")
    expect(renderContextSnapshot(after)).toContain(
      "- Web lookup: off; fetch waits for your owner to set the web lookup key",
    )
  })
})
