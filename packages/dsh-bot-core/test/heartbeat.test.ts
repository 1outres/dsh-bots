import { describe, expect, it } from "vitest"
import type { CatalogConnector } from "../src/host/connectors/catalog"
import type { SettingsRecord } from "../src/host/connectors/domain"
import { createConnectorSettings } from "../src/host/connectors/settings"
import type { EnvironmentFileSystem } from "../src/host/files"
import {
  decideBeat,
  type HeartbeatFileRead,
  type HeartbeatWaiting,
} from "../src/host/heartbeat/decide"
import type { HeartbeatSettingsRecord } from "../src/host/heartbeat/domain"
import { readHeartbeatFile } from "../src/host/heartbeat/file"
import { createHeartbeats } from "../src/host/heartbeat/heartbeats"
import { createHeartbeatPanel } from "../src/host/heartbeat/panel"
import { createHeartbeatStore } from "../src/host/heartbeat/store"
import { hasHeartbeatTasks } from "../src/host/heartbeat/tasks"
import { heartbeatNotice } from "../src/host/heartbeat/texts"
import { nextBeatAt, withinActiveHours } from "../src/host/heartbeat/timing"
import { workspaceRefusal } from "../src/host/managed/authority"
import { createSaveQueue } from "../src/host/save-queue"
import { createHeartbeatArea } from "../src/host/settings/areas/heartbeat"
import { settingsTurnOf } from "../src/host/settings/authority"
import { inputPartyOf } from "../src/host/turns/parties"
import { HEARTBEAT_MD } from "../src/host/workspace-files"
import {
  DEFAULT_HEARTBEAT,
  type HeartbeatSettings,
  parseActiveHours,
  parseHeartbeatSettings,
} from "../src/shared/heartbeat"
import { memoryTable } from "./channels-support"

const at = (iso: string) => Date.parse(iso)
const TOKYO = "Asia/Tokyo"

describe("hasHeartbeatTasks", () => {
  it("finds nothing in blank lines, headings, comments and empty list items", () => {
    expect(hasHeartbeatTasks("")).toBe(false)
    expect(hasHeartbeatTasks("  \n\t\n")).toBe(false)
    expect(hasHeartbeatTasks("# HEARTBEAT.md\n\n## Checks\n")).toBe(false)
    expect(hasHeartbeatTasks("<!-- a\nmulti-line\ncomment -->\n# Title")).toBe(false)
    expect(hasHeartbeatTasks("- \n* \n+\n1.\n2) \n- [ ]\n- [x] ")).toBe(false)
    expect(hasHeartbeatTasks("<!-- never closed\n- Check the build")).toBe(false)
    expect(hasHeartbeatTasks(HEARTBEAT_MD)).toBe(false)
  })

  it("finds a task anywhere else", () => {
    expect(hasHeartbeatTasks("# Checks\n- Look at the build page")).toBe(true)
    expect(hasHeartbeatTasks("<!-- c --> Check mail")).toBe(true)
    expect(hasHeartbeatTasks("#hashtag is text")).toBe(true)
    expect(hasHeartbeatTasks("- [ ] Water the plants")).toBe(true)
  })
})

describe("nextBeatAt", () => {
  const every = (intervalMinutes: number, activeHours?: HeartbeatSettings["activeHours"]) => ({
    enabled: true,
    intervalMinutes,
    ...(activeHours === undefined ? {} : { activeHours }),
  })

  it("lands on the bot's local clock, from midnight", () => {
    expect(nextBeatAt(every(30), TOKYO, at("2026-11-26T09:10:00+09:00"))).toBe(
      at("2026-11-26T09:30:00+09:00"),
    )
    expect(nextBeatAt(every(30), TOKYO, at("2026-11-26T09:30:00+09:00"))).toBe(
      at("2026-11-26T10:00:00+09:00"),
    )
    expect(nextBeatAt(every(45), TOKYO, at("2026-11-26T23:20:00+09:00"))).toBe(
      at("2026-11-27T00:00:00+09:00"),
    )
  })

  it("starts the day at the active hours and stays inside them", () => {
    const office = every(1440, { start: "09:00", end: "18:00" })
    expect(nextBeatAt(office, TOKYO, at("2026-11-26T08:00:00+09:00"))).toBe(
      at("2026-11-26T09:00:00+09:00"),
    )
    expect(nextBeatAt(office, TOKYO, at("2026-11-26T09:00:00+09:00"))).toBe(
      at("2026-11-27T09:00:00+09:00"),
    )
    const hourly = every(60, { start: "09:30", end: "11:00" })
    expect(nextBeatAt(hourly, TOKYO, at("2026-11-26T10:31:00+09:00"))).toBe(
      at("2026-11-27T09:30:00+09:00"),
    )
  })

  it("crosses midnight with a window that wraps", () => {
    const night = every(120, { start: "22:00", end: "03:00" })
    expect(nextBeatAt(night, TOKYO, at("2026-11-27T00:30:00+09:00"))).toBe(
      at("2026-11-27T02:00:00+09:00"),
    )
    expect(nextBeatAt(night, TOKYO, at("2026-11-27T02:00:00+09:00"))).toBe(
      at("2026-11-27T22:00:00+09:00"),
    )
  })

  it("skips a slot the clocks skip", () => {
    const zone = "America/New_York"
    expect(nextBeatAt(every(30), zone, at("2026-03-08T01:45:00-05:00"))).toBe(
      at("2026-03-08T03:00:00-04:00"),
    )
  })

  it("has no beat when off", () => {
    expect(nextBeatAt({ ...every(30), enabled: false }, TOKYO, 0)).toBeUndefined()
  })

  it("tells whether a moment is inside the active hours", () => {
    const hours = { start: "22:00", end: "06:00" }
    expect(withinActiveHours(undefined, 0, TOKYO)).toBe(true)
    expect(withinActiveHours(hours, at("2026-11-26T23:00:00+09:00"), TOKYO)).toBe(true)
    expect(withinActiveHours(hours, at("2026-11-26T06:00:00+09:00"), TOKYO)).toBe(false)
    expect(withinActiveHours(hours, at("2026-11-26T12:00:00+09:00"), TOKYO)).toBe(false)
  })
})

describe("heartbeat settings", () => {
  it("parses and refuses settings", () => {
    expect(parseHeartbeatSettings({ enabled: true, intervalMinutes: 180 })).toEqual(
      DEFAULT_HEARTBEAT,
    )
    expect(
      parseHeartbeatSettings({
        enabled: false,
        intervalMinutes: 5,
        activeHours: { start: "22:00", end: "06:00" },
      }),
    ).toEqual({ enabled: false, intervalMinutes: 5, activeHours: { start: "22:00", end: "06:00" } })
    expect(() => parseHeartbeatSettings({ enabled: true, intervalMinutes: 4 })).toThrow(
      "from 5 to 1440",
    )
    expect(() => parseHeartbeatSettings({ enabled: true, intervalMinutes: 1441 })).toThrow()
    expect(() => parseHeartbeatSettings({ enabled: true, intervalMinutes: 30.5 })).toThrow()
    expect(() =>
      parseHeartbeatSettings({
        enabled: true,
        intervalMinutes: 30,
        activeHours: { start: "09:00", end: "09:00" },
      }),
    ).toThrow("different times")
    expect(() =>
      parseHeartbeatSettings({
        enabled: true,
        intervalMinutes: 30,
        activeHours: { start: "9:00", end: "10:00" },
      }),
    ).toThrow("HH:MM")
    expect(() => parseHeartbeatSettings({ enabled: true, intervalMinutes: 30, every: 1 })).toThrow(
      'no field "every"',
    )
    expect(parseActiveHours("")).toBeUndefined()
    expect(parseActiveHours("09:00-18:00")).toEqual({ start: "09:00", end: "18:00" })
    expect(() => parseActiveHours("9-18")).toThrow()
  })

  it("stores per bot, reads the defaults otherwise, and forgets deleted bots", async () => {
    const rows = memoryTable<HeartbeatSettingsRecord>()
    const store = createHeartbeatStore({ heartbeatSettings: rows })
    const changed: string[] = []
    store.subscribe((botId) => changed.push(botId))
    expect(store.get("a")).toEqual(DEFAULT_HEARTBEAT)
    await store.set("a", { enabled: false, intervalMinutes: 60 })
    expect(store.get("a")).toEqual({ enabled: false, intervalMinutes: 60 })
    await store.purge((botId) => botId !== "a")
    expect(store.get("a")).toEqual(DEFAULT_HEARTBEAT)
    expect(changed).toEqual(["a", "a"])
  })

  it("is an area of bot_settings that the bot may change freely", async () => {
    const rows = memoryTable<HeartbeatSettingsRecord>()
    const store = createHeartbeatStore({ heartbeatSettings: rows })
    const panel = createHeartbeatPanel({
      store,
      heartbeats: { status: () => ({ pending: false }) },
      exists: (botId) => botId === "a",
    })
    const area = createHeartbeatArea({
      view: (botId) => panel.view(botId),
      configure: (botId, settings) => panel.configure(botId, settings),
    })
    const entries = await area.entries("a", new AbortController().signal)
    expect(entries.map((entry) => [entry.key, entry.value.raw, entry.change])).toEqual([
      ["enabled", true, "free"],
      ["intervalMinutes", 180, "free"],
      ["activeHours", "", "free"],
    ])
    expect(await area.apply("a", [{ key: "activeHours", value: "08:00-20:00" }])).toEqual({
      applied: true,
    })
    expect(store.get("a")).toEqual({
      enabled: true,
      intervalMinutes: 180,
      activeHours: { start: "08:00", end: "20:00" },
    })
    expect(await area.apply("a", [{ key: "intervalMinutes", value: 2 }])).toMatchObject({
      applied: false,
    })
    expect(await area.apply("a", [{ key: "activeHours", value: "" }])).toEqual({ applied: true })
    expect(store.get("a")).toEqual({ enabled: true, intervalMinutes: 180 })
    expect(await area.apply("a", [{ key: "colour", value: "red" }])).toMatchObject({
      applied: false,
    })
    await expect(panel.configure("b", DEFAULT_HEARTBEAT)).rejects.toThrow("does not exist")
  })
})

const gmail = { id: "gmail", name: "Gmail" }

describe("decideBeat and the notice", () => {
  const waiting: HeartbeatWaiting[] = [
    { connector: gmail, account: "alice@example.com", count: 3 },
    {
      connector: { id: "calendar", name: "Google Calendar" },
      account: "alice@example.com",
      count: 0,
    },
  ]

  it("calls no model when nothing waits and HEARTBEAT.md is absent or empty", () => {
    expect(decideBeat([], { kind: "absent" })).toEqual({ kind: "nothing" })
    expect(
      decideBeat([waiting[1] as HeartbeatWaiting], { kind: "text", text: HEARTBEAT_MD }),
    ).toEqual({
      kind: "nothing",
    })
  })

  it("sends for waiting events, for tasks, and for a file too large to read", () => {
    expect(decideBeat(waiting, { kind: "absent" })).toEqual({
      kind: "send",
      waiting: [waiting[0]],
      tasks: undefined,
    })
    expect(decideBeat([], { kind: "text", text: "- Check the build" })).toEqual({
      kind: "send",
      waiting: [],
      tasks: { kind: "text", text: "- Check the build" },
    })
    expect(decideBeat([], { kind: "too-large", bytes: 20_000 })).toMatchObject({ kind: "send" })
  })

  it("counts events without their content, and says to ack everything it looked at", () => {
    const notice = heartbeatNotice({
      at: at("2026-11-26T09:30:00+09:00"),
      timezone: TOKYO,
      waiting: [waiting[0] as HeartbeatWaiting],
      tasks: { kind: "text", text: "- Check the build\n" },
    })
    expect(notice.summary).toBe("Heartbeat: 3 events waiting, HEARTBEAT.md")
    expect(notice.text).toBe(
      [
        "[heartbeat] 2026-11-26T09:30:00+09:00",
        "This is your periodic heartbeat, not a message from a person.",
        "Connector events waiting for you:",
        "- Gmail (alice@example.com): 3",
        "HEARTBEAT.md:",
        "<<<heartbeat-file",
        "- Check the build",
        ">>>heartbeat-file",
        "- Read the waiting events with the matching _events_list tool (pass the account) and do what your owner would want with them.",
        "- Then acknowledge every event you looked at with the matching _events_ack tool, the ones you chose to leave alone too: events you do not acknowledge bring the heartbeat back every time.",
        "- Follow HEARTBEAT.md.",
        "- Do not bring back tasks from earlier conversations, and do not invent work.",
        "- If there is nothing to tell your owner, call stay_silent before you write anything.",
      ].join("\n"),
    )
    const tasksOnly = heartbeatNotice({
      at: 0,
      timezone: "UTC",
      waiting: [],
      tasks: { kind: "too-large", bytes: 20_000 },
    })
    expect(tasksOnly.summary).toBe("Heartbeat: HEARTBEAT.md")
    expect(tasksOnly.text).not.toContain("_events_ack")
    expect(tasksOnly.text).toContain("HEARTBEAT.md has 20000 bytes")
  })
})

describe("readHeartbeatFile", () => {
  const fsOf = (
    entries: Record<string, { readonly text?: string; readonly type?: "file" | "directory" }>,
  ) =>
    ({
      async lstat(path: string) {
        const entry = entries[path]
        return entry === undefined ? undefined : { version: "1", type: entry.type ?? "file" }
      },
      async resolve(path: string) {
        return { path }
      },
      async stat(target: { path: string }) {
        const entry = entries[target.path]
        if (entry === undefined) return undefined
        return {
          version: "1",
          type: entry.type ?? "file",
          size: new TextEncoder().encode(entry.text ?? "").length,
        }
      },
      async readBytes(target: { path: string }) {
        return new TextEncoder().encode(entries[target.path]?.text ?? "")
      },
    }) as unknown as EnvironmentFileSystem
  const signal = new AbortController().signal

  it("reads the file, or says it is absent or too large", async () => {
    expect(await readHeartbeatFile(fsOf({}), "/w", signal)).toEqual({ kind: "absent" })
    expect(
      await readHeartbeatFile(fsOf({ "HEARTBEAT.md": { type: "directory" } }), "/w", signal),
    ).toEqual({ kind: "absent" })
    expect(
      await readHeartbeatFile(fsOf({ "HEARTBEAT.md": { text: "- a" } }), "/w", signal),
    ).toEqual({
      kind: "text",
      text: "- a",
    })
    expect(
      await readHeartbeatFile(
        fsOf({ "HEARTBEAT.md": { text: "x".repeat(16 * 1024 + 1) } }),
        "/w",
        signal,
      ),
    ).toEqual({ kind: "too-large", bytes: 16 * 1024 + 1 })
  })
})

function clock(start: number) {
  let now = start
  const timers: { at: number; work: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    later(ms: number, work: () => void) {
      const timer = { at: now + ms, work, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    async advanceTo(target: number) {
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        due.cancelled = true
        now = due.at
        due.work()
        await settled()
      }
      now = target
    },
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

function rig(options: { readonly start?: number } = {}) {
  const time = clock(options.start ?? at("2026-11-26T09:10:00+09:00"))
  const state = {
    idle: true,
    settings: { enabled: true, intervalMinutes: 30 } as HeartbeatSettings,
    waiting: [] as HeartbeatWaiting[],
    file: { kind: "absent" } as HeartbeatFileRead,
    reads: 0,
    sent: [] as { readonly text: string; readonly summary: string }[],
    warnings: [] as string[],
  }
  const heartbeats = createHeartbeats({
    bots: () => ["a"],
    settings: () => state.settings,
    timezone: () => TOKYO,
    idle: () => state.idle,
    waiting: () => state.waiting,
    async read() {
      state.reads += 1
      return state.file
    },
    async enqueue(_botId, notice) {
      state.sent.push(notice)
    },
    now: time.now,
    later: time.later,
    maxDelayMs: 2147483647,
    warn: (message) => state.warnings.push(message),
  })
  heartbeats.sync()
  return { time, state, heartbeats }
}

describe("createHeartbeats", () => {
  it("skips without reading on to the model when nothing is there", async () => {
    const { time, state, heartbeats } = rig()
    expect(heartbeats.status("a").next).toBe(at("2026-11-26T09:30:00+09:00"))
    await time.advanceTo(at("2026-11-26T09:30:00+09:00"))
    expect(state.reads).toBe(1)
    expect(state.sent).toEqual([])
    expect(heartbeats.status("a")).toEqual({
      next: at("2026-11-26T10:00:00+09:00"),
      pending: false,
      last: { at: at("2026-11-26T09:30:00+09:00"), outcome: "nothing" },
    })
  })

  it("sends one notice when events wait", async () => {
    const { time, state, heartbeats } = rig()
    state.waiting = [{ connector: gmail, account: "a@example.com", count: 2 }]
    await time.advanceTo(at("2026-11-26T09:30:00+09:00"))
    expect(state.sent.map((notice) => notice.summary)).toEqual(["Heartbeat: 2 events waiting"])
    expect(heartbeats.status("a").last?.outcome).toBe("sent")
  })

  it("holds one beat while the Main is busy, and checks again once it is idle", async () => {
    const { time, state, heartbeats } = rig()
    state.idle = false
    state.waiting = [{ connector: gmail, account: "a@example.com", count: 2 }]
    await time.advanceTo(at("2026-11-26T11:00:00+09:00"))
    expect(state.reads).toBe(0)
    expect(heartbeats.status("a").pending).toBe(true)
    state.idle = true
    heartbeats.nudge("a")
    await settled()
    expect(state.sent).toHaveLength(1)
    heartbeats.nudge("a")
    await settled()
    expect(state.sent).toHaveLength(1)
  })

  it("drops a held beat when the Main handled everything meanwhile", async () => {
    const { time, state, heartbeats } = rig()
    state.idle = false
    state.waiting = [{ connector: gmail, account: "a@example.com", count: 2 }]
    await time.advanceTo(at("2026-11-26T09:30:00+09:00"))
    state.waiting = []
    state.idle = true
    heartbeats.nudge("a")
    await settled()
    expect(state.sent).toEqual([])
    expect(heartbeats.status("a").last?.outcome).toBe("nothing")
  })

  it("checks idleness again after reading HEARTBEAT.md, right before sending", async () => {
    const { time, state, heartbeats } = rig()
    state.file = { kind: "text", text: "- Check the build" }
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = state.file
    const slow = createHeartbeats({
      bots: () => ["a"],
      settings: () => state.settings,
      timezone: () => TOKYO,
      idle: () => state.idle,
      waiting: () => [],
      async read() {
        await gate
        return read
      },
      async enqueue(_botId, notice) {
        state.sent.push(notice)
      },
      now: time.now,
      later: time.later,
      maxDelayMs: 2147483647,
      warn: () => {},
    })
    heartbeats.dispose()
    slow.sync()
    await time.advanceTo(at("2026-11-26T09:30:00+09:00"))
    state.idle = false
    release()
    await settled()
    expect(state.sent).toEqual([])
    expect(slow.status("a").pending).toBe(true)
    state.idle = true
    slow.nudge("a")
    await settled()
    expect(state.sent).toHaveLength(1)
  })

  it("keeps the beat while HEARTBEAT.md cannot be read", async () => {
    const { time, state, heartbeats } = rig()
    state.file = { kind: "unavailable", reason: "the bot's environment is not available" }
    await time.advanceTo(at("2026-11-26T09:30:00+09:00"))
    expect(heartbeats.status("a").pending).toBe(true)
    expect(state.warnings).toHaveLength(1)
    state.file = { kind: "text", text: "- Water the plants" }
    heartbeats.nudge("a")
    await settled()
    expect(state.sent.map((notice) => notice.summary)).toEqual(["Heartbeat: HEARTBEAT.md"])
  })

  it("drops a held beat that the active hours ended, and stops when turned off", async () => {
    const { time, state, heartbeats } = rig({ start: at("2026-11-26T17:20:00+09:00") })
    state.settings = {
      enabled: true,
      intervalMinutes: 30,
      activeHours: { start: "09:00", end: "18:00" },
    }
    heartbeats.sync("a")
    state.idle = false
    state.waiting = [{ connector: gmail, account: "a@example.com", count: 1 }]
    await time.advanceTo(at("2026-11-26T18:10:00+09:00"))
    expect(heartbeats.status("a")).toMatchObject({
      next: at("2026-11-27T09:00:00+09:00"),
      pending: true,
    })
    state.idle = true
    heartbeats.nudge("a")
    await settled()
    expect(state.sent).toEqual([])
    expect(heartbeats.status("a")).toMatchObject({
      pending: false,
      last: { outcome: "outside-hours" },
    })
    state.settings = { ...state.settings, enabled: false }
    heartbeats.sync("a")
    expect(heartbeats.status("a").next).toBeUndefined()
    expect(heartbeats.status("a").pending).toBe(false)
  })
})

describe("the outside inputs", () => {
  it("count the heartbeat as an input from someone other than the owner", () => {
    const input = { content: [], source: { kind: "bot-heartbeat" } }
    expect(inputPartyOf(input)).toBe("other")
    const turn = { turn: 1, open: true, inputs: ["other" as const], peerMessages: [] }
    expect(settingsTurnOf(turn)?.startedBy).toBe("other")
    expect(workspaceRefusal(turn)).toMatch("someone other than your owner")
  })
})

describe("connector event deliveries", () => {
  const withEvents = {
    id: "mail",
    name: "Mail",
    events: { kinds: [], delivery: "queue", intervalMs: 60_000 },
  } as unknown as CatalogConnector
  const plain = { id: "desk", name: "Desk" } as unknown as CatalogConnector
  const setup = () => {
    const records = memoryTable<SettingsRecord>()
    const settings = createConnectorSettings({
      records,
      catalog: {
        get: (id) => [withEvents, plain].find((connector) => connector.id === id),
        list: () => [withEvents, plain],
      },
      queue: createSaveQueue(),
      spec: () => undefined,
      now: () => 1,
    })
    return { records, settings }
  }

  it("start a connector at its own delivery, and store one with every change", async () => {
    const { records, settings } = setup()
    expect(settings.view("a", withEvents).events).toBe("queue")
    await settings.configure("a", withEvents, { enabled: true, values: {} })
    expect(records.rows.get("a:mail")?.events).toBe("queue")
    expect(settings.delivery("a", "mail")).toBe("queue")
    await settings.configure("a", plain, { enabled: true, values: {} })
    expect(records.rows.get("a:desk")?.events).toBe("off")
  })

  it("keep a bot stored before deliveries had a default off, once", async () => {
    const { records, settings } = setup()
    await records.put("a:mail", {
      botId: "a",
      connectorId: "mail",
      enabled: true,
      values: {},
      updatedAt: 0,
    })
    await records.put("b:mail", {
      botId: "b",
      connectorId: "mail",
      enabled: true,
      values: {},
      events: "notify",
      updatedAt: 0,
    })
    await settings.migrateDeliveries()
    expect(settings.delivery("a", "mail")).toBe("off")
    expect(settings.view("a", withEvents).events).toBe("off")
    expect(settings.delivery("b", "mail")).toBe("notify")
  })
})
