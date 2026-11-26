import { EventEmitter } from "node:events"
import { Context } from "@deepseek-ai/cordis"
import { beforeEach, describe, expect, it, vi } from "vitest"

const connections: FakeConnection[] = []
const reachable: boolean[] = []

const streams: (EventEmitter & { label: string })[] = []

class FakeConnection {
  readonly ready: Promise<{ root: string }>
  failure: Error | undefined
  closed = false
  readonly requests: string[] = []
  disposed = 0

  constructor(readonly config: Record<string, unknown>) {
    connections.push(this)
    const ok = reachable.shift() ?? true
    const index = connections.length - 1
    this.ready = ok
      ? Promise.resolve({ root: `/tmp/dsh-ssh-${index}` })
      : Promise.reject(new Error("ssh: connect to host dsh-bot-x port 22: Connection refused"))
    void this.ready.catch((error: Error) => {
      this.failure = error
    })
  }

  get failed() {
    return this.failure !== undefined || this.closed
  }

  get ptcLaunch() {
    return { kind: "embedded", executable: "/usr/bin/node" }
  }

  async request(method: string, params?: { id?: string }): Promise<unknown> {
    if (this.failure !== undefined) throw this.failure
    this.requests.push(params?.id === undefined ? method : `${method} ${params.id}`)
    if (method === "fail") throw new Error("remote cleanup could not be confirmed")
    if (method === "process.prepare") return { id: `p${connections.indexOf(this)}`, streams: {} }
    if (method === "break") {
      this.failure = new Error("SSH helper disconnected; remote outcomes and cleanup are unknown")
      throw this.failure
    }
    return `${method}@${connections.indexOf(this)}`
  }

  async connectStream(endpoint: { path: string }) {
    const stream = Object.assign(new EventEmitter(), {
      label: `stream ${endpoint.path}@${connections.indexOf(this)}`,
    })
    streams.push(stream)
    return stream
  }

  async dispose() {
    this.disposed++
    this.closed = true
  }
}

vi.mock("../src/node/ssh/connection", () => ({
  SshConnection: FakeConnection,
  SSH_CONNECTION_DEFAULTS: {
    requestTimeoutMs: 60_000,
    maxFrameBytes: 1,
    maxPending: 1,
    leaseMs: 30_000,
  },
}))

const { default: BotVmSsh } = await import("../src/plugins/ssh")

const config = {
  host: "dsh-bot-x",
  configFile: "/state/ssh/x.conf",
  launch: { kind: "node-script" as const, node: "/usr/bin/node" },
  helper: "/opt/helper.js",
  helperHash: "a".repeat(64),
  workspace: "/bots/x",
}

async function mount() {
  const root = new Context()
  const fiber = root.plugin(BotVmSsh, config)
  await fiber
  const ssh = root.get("ssh") as unknown as InstanceType<typeof BotVmSsh>
  return { root, fiber, ssh }
}

const schema = { parse: (value: unknown) => value } as never

beforeEach(() => {
  connections.length = 0
  reachable.length = 0
  streams.length = 0
})

describe("@1outres/dsh-bot-vm/ssh", () => {
  it("mounts without connecting and connects on the first call", async () => {
    const { ssh } = await mount()
    expect(connections).toHaveLength(0)
    expect(await ssh.request("fs.stat", {}, schema)).toBe("fs.stat@0")
    expect(await ssh.request("fs.list", {}, schema)).toBe("fs.list@0")
    expect(connections).toHaveLength(1)
    expect(connections[0]?.config).toMatchObject({
      ...config,
      requestTimeoutMs: 60_000,
      leaseMs: 30_000,
    })
    expect(connections[0]?.config).not.toHaveProperty("retryDelayMs")
    expect(connections[0]?.config).not.toHaveProperty("idleMs")
  })

  it("serves streams and ptcLaunch from the live connection", async () => {
    const { ssh } = await mount()
    expect(() => ssh.ptcLaunch).toThrow("SSH helper is not ready")
    expect(
      (
        (await ssh.connectStream({
          path: "/tmp/dsh-ssh-0/s",
          capability: "c",
        } as never)) as never as { label: string }
      ).label,
    ).toBe("stream /tmp/dsh-ssh-0/s@0")
    expect(ssh.ptcLaunch).toEqual({ kind: "embedded", executable: "/usr/bin/node" })
    expect(await ssh.ready).toEqual({ root: "/tmp/dsh-ssh-0" })
  })

  it("answers calls for handles of a lost connection without touching its successor", async () => {
    const { ssh } = await mount()
    const prepared = (await ssh.request("process.prepare", {}, schema)) as { id: string }
    expect(prepared.id).toBe("p0")
    await expect(ssh.request("break", {}, schema)).rejects.toThrow("SSH helper disconnected")
    expect(await ssh.request("fs.stat", {}, schema)).toBe("fs.stat@1")

    expect(await ssh.request("process.terminate", { id: "p0" }, schema)).toBeNull()
    await expect(
      ssh.request("process.wait", { id: "p0" }, schema, undefined, true),
    ).rejects.toThrow("was lost")
    await expect(
      ssh.connectStream({ path: "/tmp/dsh-ssh-0/s", capability: "c" } as never),
    ).rejects.toThrow("was lost")
    expect(connections[1]?.requests).toEqual(["fs.stat"])

    await ssh.dispose()
    expect(connections[1]?.disposed).toBe(0)
    expect(await ssh.request("fs.list", {}, schema)).toBe("fs.list@1")
  })

  it("routes calls for a live handle to the connection that issued it", async () => {
    const { ssh } = await mount()
    await ssh.request("process.prepare", {}, schema)
    expect(await ssh.request("process.start", { id: "p0" }, schema)).toBe("process.start@0")
    expect(connections[0]?.requests).toEqual(["process.prepare", "process.start p0"])
  })

  it("stops waiting for a connection when the call is aborted", async () => {
    const { ssh } = await mount()
    const controller = new AbortController()
    controller.abort(new Error("caller gave up"))
    await expect(ssh.request("a", {}, schema, controller.signal)).rejects.toThrow("caller gave up")
  })

  it("reconnects after the connection failed", async () => {
    const { ssh } = await mount()
    await ssh.request("a", {}, schema)
    await expect(ssh.request("break", {}, schema)).rejects.toThrow("SSH helper disconnected")
    expect(connections[0]?.disposed).toBe(1)
    expect(await ssh.request("b", {}, schema)).toBe("b@1")
  })

  it("reports an unreachable VM, fails fast for a while, then retries", async () => {
    vi.useFakeTimers()
    try {
      reachable.push(false, false)
      const { ssh } = await mount()
      const failure = await ssh.request("a", {}, schema).catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe(
        "cannot reach the bot VM over SSH (dsh-bot-x): ssh: connect to host dsh-bot-x port 22: Connection refused",
      )
      expect((failure as Error).cause).toBeUndefined()
      expect(connections).toHaveLength(2)
      await expect(ssh.request("a", {}, schema)).rejects.toThrow("cannot reach the bot VM")
      expect(connections).toHaveLength(2)
      vi.advanceTimersByTime(2_000)
      expect(await ssh.request("a", {}, schema)).toBe("a@2")
    } finally {
      vi.useRealTimers()
    }
  })

  it("tries connecting again within the same call when the first handshake fails", async () => {
    reachable.push(false)
    const { ssh } = await mount()
    expect(await ssh.request("a", {}, schema)).toBe("a@1")
    expect(connections).toHaveLength(2)
    expect(connections[0]?.disposed).toBe(1)
  })

  it("concurrent calls share the retried connection", async () => {
    reachable.push(false)
    const { ssh } = await mount()
    const results = await Promise.all([
      ssh.request("a", {}, schema),
      ssh.request("b", {}, schema),
      ssh.request("c", {}, schema),
    ])
    expect(results).toEqual(["a@1", "b@1", "c@1"])
    expect(connections).toHaveLength(2)
  })

  it("dispose() closes the current connection only after a call on it failed", async () => {
    const { ssh } = await mount()
    await ssh.request("a", {}, schema)
    await ssh.dispose()
    expect(connections[0]?.disposed).toBe(0)
    await expect(ssh.request("fail", {}, schema)).rejects.toThrow("could not be confirmed")
    await ssh.dispose()
    expect(connections[0]?.disposed).toBe(1)
    expect(await ssh.request("b", {}, schema)).toBe("b@1")
  })

  it("closes its connection when the plugin unloads", async () => {
    const { fiber, ssh } = await mount()
    await ssh.request("a", {}, schema)
    await fiber.dispose()
    expect(connections[0]?.disposed).toBeGreaterThanOrEqual(1)
  })
})

describe("Reconnector handle table", () => {
  it("stays bounded when processes are never waited for", async () => {
    const { MAX_HANDLES, Reconnector } = await import("../src/host/reconnect")
    let next = 0
    const connection = {
      ready: Promise.resolve({ root: "/tmp/dsh-ssh-r" }),
      ptcLaunch: undefined,
      request: (async () => ({ id: `p${next++}`, streams: {} })) as never,
      connectStream: async () => new EventEmitter(),
    }
    const front = new Reconnector({
      host: "h",
      open: async () => ({ connection, close: async () => {} }),
      failed: () => false,
      retryDelayMs: 0,
      idleMs: 0,
      now: () => 0,
      later: () => () => {},
    })
    for (let index = 0; index < MAX_HANDLES + 10; index++) {
      await front.request("process.prepare", {}, { parse: (value: unknown) => value })
    }
    expect(front.handleCount()).toBe(MAX_HANDLES)
  })
})

describe("idle connections", () => {
  async function front() {
    const { Reconnector } = await import("../src/host/reconnect")
    const timers: { ms: number; task: () => void; cancelled: boolean }[] = []
    const opened: { closed: boolean; requests: string[] }[] = []
    const reconnector = new Reconnector({
      host: "h",
      open: async () => {
        const state = { closed: false, requests: [] as string[] }
        opened.push(state)
        const connection = {
          ready: Promise.resolve({ root: `/tmp/r${opened.length}` }),
          ptcLaunch: undefined,
          request: (async (method: string, params: { id?: string }) => {
            state.requests.push(method)
            if (method === "process.prepare") return { id: "p", streams: {} }
            if (method === "process.wait") return true
            return params?.id ?? null
          }) as never,
          connectStream: async () => new EventEmitter(),
        }
        const close = async () => {
          state.closed = true
        }
        return { connection, close }
      },
      failed: () => false,
      retryDelayMs: 0,
      idleMs: 1_000,
      now: () => 0,
      later: (ms, task) => {
        const timer = { ms, task, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    })
    const fire = () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.task()
    }
    return { reconnector, opened, fire, pending: () => timers.filter((timer) => !timer.cancelled) }
  }
  const parse = { parse: (value: unknown) => value }

  it("closes a connection nothing used for idleMs and opens a new one on the next call", async () => {
    const { reconnector, opened, fire, pending } = await front()
    await reconnector.request("fs.stat", {}, parse)
    expect(pending().map((timer) => timer.ms)).toEqual([1_000])
    fire()
    await new Promise((resolve) => setImmediate(resolve))
    expect(opened[0]?.closed).toBe(true)
    await reconnector.request("fs.stat", {}, parse)
    expect(opened).toHaveLength(2)
  })

  it("keeps a connection while a remote process or a stream is alive", async () => {
    const { reconnector, opened, fire, pending } = await front()
    await reconnector.request("process.prepare", {}, parse)
    fire()
    expect(opened[0]?.closed).toBe(false)
    const stream = (await reconnector.connectStream({ path: "/tmp/r1/s" })) as EventEmitter
    await reconnector.request("process.wait", { id: "p" }, parse, undefined, true)
    fire()
    expect(opened[0]?.closed).toBe(false)
    expect(pending()).toHaveLength(0)
    stream.emit("close")
    expect(pending()).toHaveLength(1)
    fire()
    await new Promise((resolve) => setImmediate(resolve))
    expect(opened[0]?.closed).toBe(true)
  })

  it("restarts the countdown on every call", async () => {
    const { reconnector, pending } = await front()
    await reconnector.request("a", {}, parse)
    const first = pending()[0]
    await reconnector.request("b", {}, parse)
    expect(first?.cancelled).toBe(true)
    expect(pending()).toHaveLength(1)
  })
})
