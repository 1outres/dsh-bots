/**
 * The parts of bot-core's prompt: which kind of session an Agent runs, the
 * facts the prompt row is told, the `bot:status` context, and the initial
 * workspace files.
 */
import { describe, expect, it } from "vitest"
import { WORKSPACE_FILES_VERSION } from "../src/host/domain"
import { createPromptFacts } from "../src/host/prompt/facts"
import { BOT_PROMPT_SECTIONS } from "../src/host/prompt/sections"
import { sessionKindOf } from "../src/host/prompt/session-kind"
import { renderStatus } from "../src/host/prompt/status"
import type { WritableFileSystem } from "../src/host/workspace-files"
import { AGENTS_MD, createWorkspaceFiles, SOUL_MD } from "../src/host/workspace-files"
import type { BotPromptFacts } from "../src/internal"
import type { BotConnectorView } from "../src/shared/connectors"

const agent = (id: string, parentSession?: string) => ({
  id,
  session: { header: parentSession === undefined ? {} : { parentSession } },
})

const records = {
  isMain: (botId: string, sessionId: string) => botId === "a" && sessionId === "main",
  isScheduleRun: (botId: string, sessionId: string) => botId === "a" && sessionId === "run",
  isRecorded: (botId: string, sessionId: string) =>
    botId === "a" && ["main", "run", "side", "task"].includes(sessionId),
  isStartedByMain: (botId: string, sessionId: string) => botId === "a" && sessionId === "task",
  reviewed: (botId: string, sessionId: string) =>
    botId === "a" && sessionId === "review" ? ("main" as const) : undefined,
  curating: (botId: string, sessionId: string) => botId === "a" && sessionId === "curator",
}

describe("sessionKindOf", () => {
  it("reads the kind from bot-core's records", () => {
    expect(sessionKindOf(records, "a", agent("main"))).toBe("main")
    expect(sessionKindOf(records, "a", agent("run"))).toBe("schedule")
    expect(sessionKindOf(records, "a", agent("side"))).toBe("web")
    expect(sessionKindOf(records, "a", agent("task"))).toBe("delegated")
    expect(sessionKindOf(records, "a", agent("child", "main"))).toBe("subagent")
  })

  it("reads a background skill review as the session it reviews, before its subagent header", () => {
    expect(sessionKindOf(records, "a", agent("review", "main"))).toBe("main")
  })

  it("reads a skill curation as kind curator, before its subagent header", () => {
    expect(sessionKindOf(records, "a", agent("curator", "main"))).toBe("curator")
  })

  it("refuses a session bot-core never recorded as the bot's", () => {
    expect(() => sessionKindOf(records, "a", agent("stranger"))).toThrow("not recorded")
    expect(() => sessionKindOf(records, "b", agent("main"))).toThrow("not recorded")
  })
})

const connector = (
  name: string,
  enabled: boolean,
  readiness: BotConnectorView["readiness"],
  accounts?: BotConnectorView["accounts"],
): BotConnectorView =>
  ({
    connector: { name },
    enabled,
    readiness,
    ...(accounts === undefined ? {} : { accounts }),
  }) as unknown as BotConnectorView

describe("createPromptFacts", () => {
  const facts = createPromptFacts({
    sealed: (botId, token) => botId === "a" && token === "t",
    agent: (agentId) => (agentId === "ghost" ? undefined : agent(agentId)),
    botOf: (live) => (live.id === "other" ? "b" : "a"),
    kind: records,
    management: (_botId, sessionId) =>
      sessionId === "task" || sessionId === "main" ? { answerer: "main" } : undefined,
    botName: (botId) => (botId === "a" ? "Mia" : undefined),
    channels: () => [{ name: "Discord", formatHint: "hint" }],
    channelStatus: () => [{ name: "Discord", status: { state: "connected" }, owners: [] }],
    connectors: () => [
      connector("Gmail", true, { state: "ready", since: 1 }, [
        {
          connectionId: "c1",
          label: "Work",
          email: "w@example.com",
          status: "active",
          granted: true,
        },
        { connectionId: "c2", label: "Old", status: "needs-reauth", granted: true },
        { connectionId: "c3", label: "Narrow", status: "active", granted: false },
        { connectionId: "c4", label: "Home", status: "active", granted: true },
      ]),
      connector("Desktop", false, { state: "disabled" }),
    ],
    web: () => ({ search: { state: "disabled" }, fetch: { state: "disabled" } }),
  })

  it("tells the bot's name, the session's kind and the enabled connectors with their usable accounts", () => {
    expect(facts("a", "t", "side")).toEqual({
      botName: "Mia",
      session: "web",
      channels: [{ name: "Discord", formatHint: "hint" }],
      status: {
        channels: [{ name: "Discord", status: { state: "connected" }, owners: [] }],
        connectors: [
          {
            name: "Gmail",
            readiness: { state: "ready", since: 1 },
            accounts: ["w@example.com", "Home"],
          },
        ],
        web: { search: { state: "disabled" }, fetch: { state: "disabled" } },
      },
    })
  })

  it("tells how the Main session manages a session it manages, never of the Main itself", () => {
    expect(facts("a", "t", "task")).toMatchObject({
      session: "delegated",
      management: { answerer: "main" },
    })
    expect(facts("a", "t", "main").management).toBeUndefined()
  })

  it("refuses another revision's token, another bot's Agent and an Agent that is not live", () => {
    expect(() => facts("a", "old", "side")).toThrow("was not registered")
    expect(() => facts("a", "t", "other")).toThrow("does not run a session")
    expect(() => facts("a", "t", "ghost")).toThrow("does not run a session")
  })
})

describe("renderStatus", () => {
  it("names every channel, connector and web lookup state", () => {
    expect(
      renderStatus({
        channels: [
          { name: "Discord", status: { state: "connected" }, owners: ["1", "2"] },
          { name: "Telegram", status: { state: "failed", message: "bad token" }, owners: [] },
          { name: "Slack", status: { state: "incomplete", missing: ["token"] }, owners: ["3"] },
        ],
        connectors: [
          { name: "Gmail", readiness: { state: "ready", since: 1 }, accounts: ["a@example.com"] },
          {
            name: "Desktop",
            readiness: { state: "preparing", since: 1, stage: { kind: "queued", since: 1 } },
            accounts: [],
          },
          {
            name: "Calendar",
            readiness: { state: "unavailable", cause: "accounts", reason: "no account" },
            accounts: [],
          },
          { name: "Browser", readiness: { state: "failed", reason: "boom", at: 1 }, accounts: [] },
        ],
        web: {
          search: { state: "ready", backend: "exa" },
          fetch: { state: "unavailable", backend: "exa", reason: "not-registered" },
        },
      }),
    ).toBe(
      [
        "Bot status:",
        "- Chat channels: Discord (connected; owners: 1, 2), Telegram (connection failed: bad token; no owner listed: nobody there can instruct you as your owner), Slack (settings incomplete; owners: 3)",
        "- Connectors: Gmail (ready; a@example.com), Desktop (preparing), Calendar (unavailable: no account), Browser (failed: boom)",
        "- Web lookup: search only; fetch is unavailable (not-registered)",
      ].join("\n"),
    )
  })

  it("still lists every item when there is nothing", () => {
    expect(
      renderStatus({
        channels: [],
        connectors: [],
        web: { search: { state: "disabled" }, fetch: { state: "disabled" } },
      }),
    ).toBe("Bot status:\n- Chat channels: none\n- Connectors: none\n- Web lookup: off")
  })
})

describe("BOT_PROMPT_SECTIONS", () => {
  const base: BotPromptFacts = {
    botName: "Mia",
    session: "main",
    channels: [{ name: "Discord", formatHint: "tables do not render." }, { name: "Plain" }],
    status: {
      channels: [],
      connectors: [],
      web: { search: { state: "disabled" }, fetch: { state: "disabled" } },
    },
  }
  const textOf = (name: string, facts: BotPromptFacts) =>
    BOT_PROMPT_SECTIONS.find((part) => part.name === name)?.text(facts)

  it("ends the messages section with each channel's formatting line", () => {
    expect(textOf("bot:messages", base)?.endsWith("\n- Discord: tables do not render.")).toBe(true)
  })

  it("leaves the messages out of schedule runs and subagents, and the workspace files out of subagents", () => {
    expect(textOf("bot:messages", { ...base, session: "schedule" })).toBe("")
    expect(textOf("bot:messages", { ...base, session: "subagent" })).toBe("")
    expect(textOf("bot:workspace-files", { ...base, session: "schedule" })).not.toBe("")
    expect(textOf("bot:workspace-files", { ...base, session: "subagent" })).toBe("")
  })
})

/** A workspace file system in memory, recording its writes. */
function memoryFs(files: Map<string, string>, fail?: string): WritableFileSystem {
  const path = (target: object) => (target as { path: string }).path
  return {
    resolve: async (name, options) => ({ path: `${options?.cwd}/${name}` }),
    processPath: path,
    contains: () => true,
    stat: async () => undefined,
    lstat: async (name, options) =>
      files.has(`${options?.cwd}/${name}`) ? { version: "1", type: "file" } : undefined,
    streamText: async () => (async function* () {})(),
    readBytes: async () => new Uint8Array(),
    readByteRange: async () => new Uint8Array(),
    listDir: async () => [],
    async writeText(target, content, expected) {
      expect(expected).toEqual({ kind: "createIfAbsent" })
      if (path(target).endsWith(fail ?? "\0")) throw new Error("disk full")
      if (files.has(path(target))) throw new Error("exists")
      files.set(path(target), content)
    },
  }
}

describe("createWorkspaceFiles", () => {
  const setup = (files: Map<string, string>, options: { fail?: string; fs?: boolean } = {}) => {
    const marked: string[] = []
    const placed = new Set<string>()
    const workspaceFiles = createWorkspaceFiles({
      fsOf: () => (options.fs === false ? undefined : memoryFs(files, options.fail)),
      workspace: () => "/home/bot/workspace",
      version: WORKSPACE_FILES_VERSION,
      placed: (botId) => placed.has(botId),
      async mark(botId) {
        marked.push(botId)
        placed.add(botId)
      },
    })
    return { workspaceFiles, marked }
  }
  const signal = new AbortController().signal

  it("places AGENTS.md and SOUL.md once, through the environment's file system", async () => {
    const files = new Map<string, string>()
    const { workspaceFiles, marked } = setup(files)
    await Promise.all([workspaceFiles.ensure("a", signal), workspaceFiles.ensure("a", signal)])
    expect(files).toEqual(
      new Map([
        ["/home/bot/workspace/AGENTS.md", AGENTS_MD],
        ["/home/bot/workspace/SOUL.md", SOUL_MD],
      ]),
    )
    expect(marked).toEqual(["a"])
    files.clear()
    await workspaceFiles.ensure("a", signal)
    expect(files.size).toBe(0)
  })

  it("keeps a file that is already there", async () => {
    const files = new Map([["/home/bot/workspace/SOUL.md", "# Mine"]])
    const { workspaceFiles } = setup(files)
    await workspaceFiles.ensure("a", signal)
    expect(files.get("/home/bot/workspace/SOUL.md")).toBe("# Mine")
    expect(files.get("/home/bot/workspace/AGENTS.md")).toBe(AGENTS_MD)
  })

  it("records nothing when a file cannot be written or the environment is not there", async () => {
    const failing = setup(new Map(), { fail: "SOUL.md" })
    await expect(failing.workspaceFiles.ensure("a", signal)).rejects.toThrow("disk full")
    expect(failing.marked).toEqual([])
    const absent = setup(new Map(), { fs: false })
    await expect(absent.workspaceFiles.ensure("a", signal)).rejects.toThrow("not available")
    expect(absent.marked).toEqual([])
  })
})
