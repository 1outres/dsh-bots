import { createHash, randomBytes } from "node:crypto"
import { posix } from "node:path"
import type {
  OwnerApprovalOutcome,
  OwnerApprovalRequest,
  OwnerApprovals,
} from "../../src/host/interactions/owner-approval"
import type { NoticeSpace } from "../../src/host/notices/domain"
import type { SettingsTurn } from "../../src/host/settings/authority"
import type { SpaceBlobIo } from "../../src/host/spaces/blobs"
import type { SpaceWorkspaceFs } from "../../src/host/spaces/manage"
import { type BotSpaces, openBotSpaces } from "../../src/host/spaces/system"
import type { BotSessionKind } from "../../src/internal"
import { memoryTable } from "./skills-fs"

export const WORKSPACE = "/home/bot"

export interface MemoryWorkspace extends SpaceWorkspaceFs {
  readonly files: Map<string, Uint8Array>
  readonly links: Map<string, string>
  write(path: string, content: string | Uint8Array): void
}

const pathOf = (target: object) => (target as { path: string }).path

export function memoryWorkspace(): MemoryWorkspace {
  const files = new Map<string, Uint8Array>()
  const links = new Map<string, string>()
  const absolute = (path: string, cwd?: string) =>
    posix.normalize(path.startsWith("/") ? path : `${cwd ?? WORKSPACE}/${path}`)
  const follow = (path: string): string => {
    const parts = path.split("/").filter((part) => part !== "")
    let current = ""
    for (const part of parts) {
      current = `${current}/${part}`
      const link = links.get(current)
      if (link !== undefined) current = follow(absolute(link, posix.dirname(current)))
    }
    return current === "" ? "/" : current
  }
  const isDirectory = (path: string) => [...files.keys()].some((key) => key.startsWith(`${path}/`))
  const encoder = new TextEncoder()
  return {
    files,
    links,
    write(path, content) {
      files.set(absolute(path), typeof content === "string" ? encoder.encode(content) : content)
    },
    resolve: async (path, options) => ({ path: follow(absolute(path, options?.cwd)) }),
    contains: (parent, child) =>
      pathOf(child).startsWith(`${pathOf(parent)}/`) || pathOf(child) === pathOf(parent),
    async lstat(path, options) {
      const full = absolute(path, options?.cwd)
      const parent = follow(posix.dirname(full))
      const at = `${parent}/${posix.basename(full)}`
      if (links.has(at)) return { type: "symlink" }
      const file = files.get(at)
      if (file !== undefined) return { type: "file", size: file.length }
      return isDirectory(at) ? { type: "directory" } : undefined
    },
    async listDir(target) {
      const prefix = `${pathOf(target)}/`
      const names = new Map<
        string,
        { name: string; type: "file" | "directory" | "other"; size?: number }
      >()
      for (const [path, data] of files) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const name = rest.split("/")[0] as string
        names.set(
          name,
          rest.includes("/")
            ? { name, type: "directory" }
            : { name, type: "file", size: data.length },
        )
      }
      for (const link of links.keys()) {
        if (posix.dirname(link) === pathOf(target))
          names.set(posix.basename(link), { name: posix.basename(link), type: "other" })
      }
      return [...names.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
    async readBytes(target, _signal, maxBytes) {
      const file = files.get(pathOf(target))
      if (file === undefined) throw new Error(`${pathOf(target)}: not found`)
      return file.slice(0, maxBytes)
    },
    async writeText(target, content) {
      if (files.has(pathOf(target))) throw new Error("exists")
      files.set(pathOf(target), encoder.encode(content))
      return { version: "1" }
    },
  }
}

export function memoryBlobs(): SpaceBlobIo & { readonly blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>()
  return {
    blobs,
    read(hash) {
      const data = blobs.get(hash)
      return new ReadableStream({
        start(controller) {
          if (data === undefined) controller.error(new Error("no blob"))
          else {
            controller.enqueue(data)
            controller.close()
          }
        },
      })
    },
    async write(hash, bytes) {
      blobs.set(hash, bytes)
    },
    async delete(hash) {
      blobs.delete(hash)
    },
    list: async () => [...blobs.keys()],
  }
}

export interface ScriptedApprovals extends OwnerApprovals {
  readonly asked: OwnerApprovalRequest[]
  answer: OwnerApprovalOutcome["kind"]
}

export function scriptedApprovals(): ScriptedApprovals {
  const approvals: ScriptedApprovals = {
    asked: [],
    answer: "approved",
    async ask(request) {
      approvals.asked.push(request)
      return approvals.answer === "approved"
        ? { kind: "approved", by: { kind: "web" } }
        : { kind: approvals.answer }
    },
  }
  return approvals
}

export interface Queued {
  readonly botId: string
  readonly text: string
  readonly summary: string
  readonly space: NoticeSpace
}

export interface SpacesHarness {
  readonly spaces: BotSpaces
  readonly fs: MemoryWorkspace
  readonly io: ReturnType<typeof memoryBlobs>
  readonly queued: Queued[]
  readonly approvals: {
    visibility: ScriptedApprovals
    visitorWrites: ScriptedApprovals
    link: ScriptedApprovals
  }
  readonly timers: { ms: number; work: () => void; cancelled: boolean }[]
  readonly bots: Set<string>
  clock: { now: number }
  turn: SettingsTurn | undefined
  kind: BotSessionKind
  shared: boolean
  flush(): void
}

export async function spacesHarness(
  options: { readonly baseUrl?: string } = {},
): Promise<SpacesHarness> {
  const fs = memoryWorkspace()
  const io = memoryBlobs()
  const queued: Queued[] = []
  const timers: { ms: number; work: () => void; cancelled: boolean }[] = []
  const bots = new Set(["b1", "b2"])
  const approvals = {
    visibility: scriptedApprovals(),
    visitorWrites: scriptedApprovals(),
    link: scriptedApprovals(),
  }
  const harness = {
    fs,
    io,
    queued,
    approvals,
    timers,
    bots,
    clock: { now: 1_000_000 },
    turn: { startedBy: "owner", mixed: false } as SettingsTurn | undefined,
    kind: "main" as BotSessionKind,
    shared: false,
    flush() {
      for (const timer of [...timers]) {
        if (timer.cancelled) continue
        timer.cancelled = true
        timer.work()
      }
    },
  }
  const spaces = await openBotSpaces({
    tables: {
      spaces: memoryTable(),
      revisions: memoryTable(),
      access: memoryTable(),
      kv: memoryTable(),
      spaceSettings: memoryTable(),
    },
    blobIo: io,
    sha256Hex: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    randomToken: () => randomBytes(32).toString("base64url"),
    wrapperScriptHash: "HASH",
    place: () => ({ fs, workspace: WORKSPACE }),
    exists: (botId) => bots.has(botId),
    bot: (botId) => (bots.has(botId) ? { name: `Bot ${botId}` } : undefined),
    avatar: async () => "data:image/png;base64,AAAA",
    advertisedUrl: () => "http://10.0.0.1:3080",
    notices: {
      async enqueue(botId, notice, space) {
        queued.push({ botId, ...notice, space })
      },
      async withdraw(matches) {
        let events = 0
        for (const entry of [...queued]) {
          if (!matches(entry.space)) continue
          queued.splice(queued.indexOf(entry), 1)
          events += entry.space.events
        }
        return events
      },
      pending: (spaceId) =>
        queued
          .filter((entry) => entry.space.spaceId === spaceId)
          .reduce((sum, entry) => sum + entry.space.events, 0),
    },
    tool: {
      sealed: (_botId, token) => token === "sealed",
      session: (botId, agentId) =>
        bots.has(botId) ? { sessionId: agentId, kind: harness.kind } : undefined,
      turn: () => harness.turn,
      homeShared: () => harness.shared,
    },
    approvals,
    newNonce: () => "nonce",
    now: () => harness.clock.now,
    later(ms, work) {
      const timer = { ms, work, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    warn: () => {},
  })
  if (options.baseUrl !== undefined)
    await spaces.store.setSettings({ publicBaseUrl: options.baseUrl })
  return Object.assign(harness, { spaces })
}

export const call = (harness: SpacesHarness, tool: string, args: object, botId = "b1") =>
  harness.spaces.tools.call(
    botId,
    "sealed",
    { agentId: "s1", tool: tool as never, args },
    new AbortController().signal,
  )
