import { describe, expect, it } from "vitest"
import type { BotChannelCapabilities, BotChannelOutput } from "../src/contract"
import { createMainFeed } from "../src/host/channels/feed"
import { createChannelOutlets } from "../src/host/channels/outlets"
import { createPresentedFiles, presentationOf } from "../src/host/channels/presented"
import { createPresentedDelivery } from "../src/host/channels/presented-delivery"
import { type PresentedNotice, presentedNoticeOf } from "../src/host/channels/presented-notice"
import { createChannelSequence } from "../src/host/channels/sequence"
import { createTurnSilence, turnBoundaryOf } from "../src/host/channels/silence"
import type { EnvironmentFileSystem } from "../src/host/files"
import { CAPABILITIES, settle } from "./channels-support"

type Entry = { type: "file" | "directory" | "symlink"; data?: Uint8Array; to?: string }

function memoryFs(entries: Record<string, Entry>): EnvironmentFileSystem {
  const absolute = (path: string, cwd = "/") =>
    path.startsWith("/") ? path : `${cwd.replace(/\/$/, "")}/${path}`
  const follow = (path: string) => {
    const entry = entries[path]
    return entry?.type === "symlink" ? (entry.to as string) : path
  }
  const target = (path: string) => ({ path })
  return {
    async resolve(path, options) {
      return target(follow(absolute(path, options?.cwd)))
    },
    processPath: (value) => (value as { path: string }).path,
    contains: (parent, child) =>
      (child as { path: string }).path.startsWith(`${(parent as { path: string }).path}/`),
    async stat(value) {
      const entry = entries[(value as { path: string }).path]
      if (entry === undefined) return undefined
      return {
        version: "1",
        type: entry.type === "symlink" ? "other" : entry.type,
        size: entry.data?.byteLength,
      }
    },
    async lstat(path, options) {
      const entry = entries[absolute(path, options?.cwd)]
      return entry === undefined
        ? undefined
        : { version: "1", type: entry.type, size: entry.data?.byteLength }
    },
    async readBytes(value, _signal, maxBytes) {
      const data = entries[(value as { path: string }).path]?.data ?? new Uint8Array()
      if (data.byteLength > maxBytes) throw new Error("too large")
      return data
    },
    streamText: async () => (async function* () {})(),
    readByteRange: async () => new Uint8Array(),
    listDir: async () => [],
  }
}

const bytes = (length: number) => new Uint8Array(length).fill(7)

const FILES = {
  "/w": { type: "directory" },
  "/w/out": { type: "directory" },
  "/w/out/report.txt": { type: "file", data: bytes(40) },
  "/w/chart.png": { type: "file", data: bytes(60) },
  "/w/big.bin": { type: "file", data: bytes(101) },
  "/w/escape": { type: "symlink", to: "/etc/passwd" },
  "/etc/passwd": { type: "file", data: bytes(5) },
} satisfies Record<string, Entry>

const presented = (turn: number, ...files: { path: string; description?: string }[]) => ({
  type: "deliverables/presented",
  data: { turn, callId: `call-${turn}`, files },
})

describe("presentationOf", () => {
  it("reads present's event, trimming descriptions and dropping empty ones", () => {
    expect(
      presentationOf(
        presented(2, { path: "/w/a", description: " A " }, { path: "/w/b", description: "  " }),
      ),
    ).toEqual({ turn: 2, files: [{ path: "/w/a", description: "A" }, { path: "/w/b" }] })
    expect(presentationOf({ type: "tools/result", data: {} })).toBe(undefined)
  })
})

describe("createPresentedFiles", () => {
  it("keeps a path once, where it was first presented, with its latest description", () => {
    const files = createPresentedFiles()
    files.record("s", {
      turn: 1,
      files: [{ path: "/w/a", description: "first" }, { path: "/w/b" }],
    })
    files.record("s", { turn: 1, files: [{ path: "/w/c" }, { path: "/w/a", description: "last" }] })
    files.record("s", { turn: 1, files: [{ path: "/w/b", description: "b" }] })
    files.record("other", { turn: 1, files: [{ path: "/w/z" }] })
    expect(files.take("s", 1)).toEqual([
      { path: "/w/a", description: "last" },
      { path: "/w/b", description: "b" },
      { path: "/w/c" },
    ])
    expect(files.take("s", 1)).toEqual([])
    expect(files.take("other", 1)).toEqual([{ path: "/w/z" }])
  })

  it("lets a later presentation without a description drop the caption", () => {
    const files = createPresentedFiles()
    files.record("s", { turn: 1, files: [{ path: "/w/a", description: "first" }] })
    files.record("s", { turn: 1, files: [{ path: "/w/a" }] })
    expect(files.take("s", 1)).toEqual([{ path: "/w/a" }])
  })

  it("gives a turn only its own files, and forgets", () => {
    const files = createPresentedFiles()
    files.record("s", { turn: 1, files: [{ path: "/w/old" }] })
    files.record("s", { turn: 2, files: [{ path: "/w/new" }] })
    expect(files.take("s", 1)).toEqual([])
    files.record("s", { turn: 3, files: [{ path: "/w/x" }] })
    files.forget("s")
    expect(files.take("s", 3)).toEqual([])
  })
})

describe("createChannelSequence", () => {
  it("publishes at once while nothing runs, and holds later outputs behind work", async () => {
    const published: string[] = []
    const warnings: string[] = []
    const sequence = createChannelSequence({
      publish: (botId, output) => published.push(`${botId} ${output.kind}`),
      warn: (message) => warnings.push(message),
    })
    const turn: BotChannelOutput = { kind: "turn", turn: { phase: "completed" } }
    sequence.publish("a", turn)
    expect(published).toEqual(["a turn"])
    let finish = () => {}
    sequence.run(
      "a",
      () =>
        new Promise<void>((resolve) => {
          published.push("a work")
          finish = resolve
        }),
    )
    sequence.publish("a", turn)
    sequence.publish("b", turn)
    sequence.run("a", async () => {
      throw new Error("boom")
    })
    sequence.publish("a", turn)
    expect(published).toEqual(["a turn", "a work", "b turn"])
    finish()
    await settle()
    expect(published).toEqual(["a turn", "a work", "b turn", "a turn", "a turn"])
    expect(warnings).toEqual(['bot-core: channel work of bot "a" failed: boom'])
    sequence.publish("a", turn)
    expect(published).toHaveLength(6)
  })
})

describe("the Main feed's presented files", () => {
  function setup() {
    const silence = createTurnSilence()
    const log: string[] = []
    const deliveries: string[][] = []
    let release = () => {}
    const feed = createMainFeed({
      botOfMainSession: (sessionId) => (sessionId === "main-a" ? "a" : undefined),
      isSilent: (sessionId) => silence.isSilent(sessionId),
      isMaintenance: () => false,
      presented: createPresentedFiles(),
      sequence: createChannelSequence({
        publish: (_botId, output) =>
          log.push(
            output.kind === "reply"
              ? `reply ${output.reply.id}`
              : output.kind === "turn"
                ? `turn ${output.turn.phase}`
                : output.kind,
          ),
        warn: () => {},
      }),
      deliverFiles: (_botId, files) =>
        new Promise<void>((resolve) => {
          deliveries.push(files.map((file) => file.path))
          log.push(`files ${files.map((file) => file.path).join(",")}`)
          release = resolve
        }),
    })
    const event = (sessionId: string, value: { type: string; data: unknown }) => {
      const boundary = turnBoundaryOf(value)
      if (boundary !== undefined) silence.follow(sessionId, boundary)
      feed.sessionEvent(sessionId, value)
    }
    const reply = (id: string) => ({
      type: "assistant/message",
      data: { message: { id, content: [{ type: "text", text: id }] } },
    })
    const start = (turn: number) => ({ type: "turn/start", data: { turn } })
    const end = (turn: number, kind = "completed") => ({
      type: "turn/end",
      data: { turn, reason: { kind } },
    })
    return { silence, log, deliveries, event, reply, start, end, release: () => release() }
  }

  it("sends a turn's files after its last reply and before its end, and holds the next turn", async () => {
    const { log, event, reply, start, end, release } = setup()
    event("main-a", start(1))
    event("main-a", presented(1, { path: "/w/a" }))
    event("main-a", reply("r1"))
    event("main-a", presented(1, { path: "/w/b" }, { path: "/w/a" }))
    event("main-a", reply("r2"))
    event("main-a", end(1))
    event("main-a", start(2))
    event("main-a", reply("r3"))
    expect(log).toEqual(["turn started", "reply r1", "reply r2", "files /w/a,/w/b"])
    release()
    await settle()
    expect(log).toEqual([
      "turn started",
      "reply r1",
      "reply r2",
      "files /w/a,/w/b",
      "turn completed",
      "turn started",
      "reply r3",
    ])
  })

  it("withholds what a silent turn presented after stay_silent, not before", async () => {
    const { silence, deliveries, event, start, end, release } = setup()
    event("main-a", start(1))
    event("main-a", presented(1, { path: "/w/before" }))
    silence.silence("main-a")
    event("main-a", presented(1, { path: "/w/after" }))
    event("main-a", end(1))
    release()
    await settle()
    expect(deliveries).toEqual([["/w/before"]])
  })

  it("sends nothing for a turn that presented nothing, nor for a silent turn's files alone", async () => {
    const { silence, log, deliveries, event, start, end } = setup()
    event("main-a", start(1))
    event("main-a", end(1))
    event("main-a", start(2))
    silence.silence("main-a")
    event("main-a", presented(2, { path: "/w/x" }))
    event("main-a", end(2))
    await settle()
    expect(deliveries).toEqual([])
    expect(log).toEqual(["turn started", "turn completed", "turn started", "turn completed"])
  })

  it("never sends what other sessions present", async () => {
    const { deliveries, event, start, end } = setup()
    for (const session of ["side", "schedule-run", "subagent"]) {
      event(session, start(1))
      event(session, presented(1, { path: `/w/${session}` }))
      event(session, end(1))
    }
    await settle()
    expect(deliveries).toEqual([])
  })

  it("sends files on every live end, and drops them on an end written after the fact", async () => {
    const { deliveries, event, start, end, release } = setup()
    event("main-a", start(1))
    event("main-a", presented(1, { path: "/w/failed" }))
    event("main-a", end(1, "max-tokens"))
    release()
    await settle()
    event("main-a", start(2))
    event("main-a", presented(2, { path: "/w/interrupted" }))
    event("main-a", end(2, "interrupted"))
    event("main-a", start(3))
    event("main-a", end(3))
    await settle()
    expect(deliveries).toEqual([["/w/failed"]])
  })
})

describe("createPresentedDelivery", () => {
  type Connection = {
    channelId: string
    capabilities?: BotChannelCapabilities
    fail?: string
  }

  function setup(options: { connections?: Connection[]; ready?: boolean; maxBytes?: number } = {}) {
    const outlets = createChannelOutlets({ warn: () => {} })
    const received: string[] = []
    for (const connection of options.connections ?? [{ channelId: "chat" }]) {
      outlets.attach(
        "a",
        {
          channelId: connection.channelId,
          capabilities: connection.capabilities ?? CAPABILITIES,
          connection: {
            async receive(output) {
              if (connection.fail !== undefined) throw new Error(connection.fail)
              received.push(
                output.kind === "file"
                  ? `${connection.channelId} file ${output.file.name} ${output.file.data.byteLength} ${output.file.caption ?? "-"}`
                  : output.kind === "reply"
                    ? `${connection.channelId} reply ${output.reply.id}`
                    : `${connection.channelId} ${output.kind}`,
              )
            },
            async close() {},
          },
        },
        new AbortController().signal,
      )
    }
    const notices: PresentedNotice[] = []
    const fs = memoryFs(FILES)
    const delivery = createPresentedDelivery({
      environmentOf: () => (options.ready === false ? undefined : { fs, workspace: "/w" }),
      outlets,
      maxBytes: options.maxBytes ?? 1000,
      signal: () => new AbortController().signal,
      async notify(botId, notice) {
        expect(botId).toBe("a")
        notices.push(notice)
      },
      warn: () => {},
    })
    return { outlets, delivery, received, notices }
  }

  it("sends each file with its description as the caption, and tells nothing when all arrived", async () => {
    const { delivery, received, notices } = setup()
    await delivery.deliver("a", [
      { path: "/w/out/report.txt", description: "The report" },
      { path: "/w/chart.png" },
    ])
    await settle()
    expect(received).toEqual(["chat file report.txt 40 The report", "chat file chart.png 60 -"])
    expect(notices).toEqual([])
  })

  it("reads nothing and tells nothing while no connection takes files", async () => {
    const textOnly: BotChannelCapabilities = { turns: true, interactions: [], commands: [] }
    const { delivery, received, notices } = setup({
      connections: [{ channelId: "chat", capabilities: textOnly }],
    })
    await delivery.deliver("a", [{ path: "/etc/passwd" }])
    await settle()
    expect(received).toEqual([])
    expect(notices).toEqual([])
    const none = setup({ connections: [], ready: false })
    await none.delivery.deliver("a", [{ path: "/w/out/report.txt" }])
    await settle()
    expect(none.notices).toEqual([])
  })

  it("tells the Main session about files outside the workspace, links, missing and too large ones", async () => {
    const { delivery, received, notices } = setup({ maxBytes: 100 })
    await delivery.deliver("a", [
      { path: "/etc/passwd" },
      { path: "/w/escape" },
      { path: "/w/gone.txt" },
      { path: "/w/big.bin" },
      { path: "/w/out/report.txt" },
    ])
    await settle()
    expect(received).toEqual(["chat file report.txt 40 -"])
    expect(notices).toHaveLength(1)
    const text = notices[0]?.text ?? ""
    expect(text).toContain("4 files you presented did not reach every chat channel")
    expect(text).toContain('- "/etc/passwd": not sent: "/etc/passwd" is outside the workspace (/w)')
    expect(text).toContain('- "/w/escape": not sent: "/w/escape" is a symlink')
    expect(text).toContain('- "/w/gone.txt": not sent: no file at "/w/gone.txt"')
    expect(text).toContain(
      '- "/w/big.bin": not sent: "/w/big.bin" has 101 bytes, more than the 100',
    )
    expect(text).not.toContain("report.txt")
    expect(text).toContain("present the new file")
    expect(text).toContain("Do not present a file again unchanged")
    expect(notices[0]?.summary).toBe("4 files you presented did not reach every chat channel")
  })

  it("tells which channels a file did not reach, by size or by error", async () => {
    const small: BotChannelCapabilities = { ...CAPABILITIES, files: { maxBytes: 50 } }
    const { delivery, received, notices } = setup({
      connections: [
        { channelId: "chat" },
        { channelId: "small", capabilities: small },
        { channelId: "broken", fail: "upload refused" },
      ],
    })
    await delivery.deliver("a", [{ path: "/w/chart.png" }, { path: "/w/out/report.txt" }])
    await settle()
    expect(received).toEqual([
      "chat file chart.png 60 -",
      "chat file report.txt 40 -",
      "small file report.txt 40 -",
    ])
    expect(notices.map((notice) => notice.text.split("\n").slice(0, 3))).toEqual([
      [
        "2 files you presented did not reach every chat channel connected to you:",
        '- "/w/chart.png": sent to chat; not sent to small: larger than its 50 byte limit; not sent to broken: upload refused',
        '- "/w/out/report.txt": sent to chat; sent to small; not sent to broken: upload refused',
      ],
    ])
  })

  it("tells the Main session when the environment is not ready", async () => {
    const { delivery, received, notices } = setup({ ready: false })
    await delivery.deliver("a", [{ path: "/w/out/report.txt" }])
    await settle()
    expect(received).toEqual([])
    expect(notices[0]?.text.split("\n").slice(0, 2)).toEqual([
      "1 file you presented did not reach every chat channel connected to you:",
      '- "/w/out/report.txt": not sent: your environment was not ready, so the file could not be read',
    ])
  })

  it("queues the files on each connection after the turn's replies and before its end", async () => {
    const { outlets, delivery, received } = setup({
      connections: [{ channelId: "one" }, { channelId: "two" }],
    })
    const feed = createMainFeed({
      botOfMainSession: () => "a",
      isSilent: () => false,
      isMaintenance: () => false,
      presented: createPresentedFiles(),
      sequence: createChannelSequence({
        publish: (botId, output) => outlets.publish(botId, output),
        warn: () => {},
      }),
      deliverFiles: (botId, files) => delivery.deliver(botId, files),
    })
    feed.sessionEvent("main-a", { type: "turn/start", data: { turn: 1 } })
    feed.sessionEvent("main-a", presented(1, { path: "/w/out/report.txt", description: "R" }))
    feed.sessionEvent("main-a", {
      type: "assistant/message",
      data: { message: { id: "done", content: [{ type: "text", text: "Here it is" }] } },
    })
    feed.sessionEvent("main-a", {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    })
    await settle()
    const of = (channel: string) => received.filter((line) => line.startsWith(`${channel} `))
    expect(of("one")).toEqual([
      "one turn",
      "one reply done",
      "one file report.txt 40 R",
      "one turn",
    ])
    expect(of("two")).toEqual([
      "two turn",
      "two reply done",
      "two file report.txt 40 R",
      "two turn",
    ])
  })
})

describe("presentedNoticeOf", () => {
  it("makes no notice when every file reached every channel", () => {
    expect(
      presentedNoticeOf({
        kind: "read",
        results: [
          {
            kind: "queued",
            file: { path: "/w/a" },
            deliveries: [{ channelId: "chat", outcome: "sent" }],
          },
        ],
      }),
    ).toBe(undefined)
  })
})
