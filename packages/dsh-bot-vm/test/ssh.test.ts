import { Context, Service } from "@deepseek-ai/cordis"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** Fake dsh-ssh connections, in creation order. */
const connections: FakeConnection[] = []
/** Whether the next connection's helper answers. */
const reachable: boolean[] = []

class FakeConnection extends Service {
  readonly ready: Promise<{ root: string }>
  failure: Error | undefined
  closed = false
  readonly requests: string[] = []
  disposed = 0

  constructor(
    ctx: Context,
    readonly config: Record<string, unknown>,
  ) {
    // Like the real one: provides "ssh" in the context it gets.
    super(ctx, "ssh")
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
    return `stream ${endpoint.path}@${connections.indexOf(this)}`
  }

  async dispose() {
    this.disposed++
    this.closed = true
  }
}

vi.mock("@deepseek-ai/dsh-ssh", () => ({ SshConnection: FakeConnection }))

const { default: BotVmSsh } = await import("../src/plugins/ssh")

const config = {
  host: "dsh-bot-x",
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
      requestTimeoutMs: 30_000,
      leaseMs: 30_000,
    })
    expect(connections[0]?.config).not.toHaveProperty("retryDelayMs")
  })

  it("serves streams and ptcLaunch from the live connection", async () => {
    const { ssh } = await mount()
    expect(() => ssh.ptcLaunch).toThrow("SSH helper is not ready")
    expect(await ssh.connectStream({ path: "/tmp/dsh-ssh-0/s", capability: "c" } as never)).toBe(
      "stream /tmp/dsh-ssh-0/s@0",
    )
    expect(ssh.ptcLaunch).toEqual({ kind: "embedded", executable: "/usr/bin/node" })
    expect(await ssh.ready).toEqual({ root: "/tmp/dsh-ssh-0" })
  })

  it("answers calls for handles of a lost connection without touching its successor", async () => {
    const { ssh } = await mount()
    const prepared = (await ssh.request("process.prepare", {}, schema)) as { id: string }
    expect(prepared.id).toBe("p0")
    await expect(ssh.request("break", {}, schema)).rejects.toThrow("SSH helper disconnected")
    expect(await ssh.request("fs.stat", {}, schema)).toBe("fs.stat@1")

    // The old process is gone with its helper: a release resolves, anything else fails.
    expect(await ssh.request("process.terminate", { id: "p0" }, schema)).toBeNull()
    await expect(
      ssh.request("process.wait", { id: "p0" }, schema, undefined, true),
    ).rejects.toThrow("was lost")
    await expect(
      ssh.connectStream({ path: "/tmp/dsh-ssh-0/s", capability: "c" } as never),
    ).rejects.toThrow("was lost")
    expect(connections[1]?.requests).toEqual(["fs.stat"])

    // And the providers' dispose() after such a failure leaves the healthy successor alone.
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
      // No cause chain: DSH renders message and causes, which repeated the text (E2E).
      expect((failure as Error).cause).toBeUndefined()
      // Both connect attempts of the call were used.
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
    // A VM that just booted: the first helper start misses the handshake deadline.
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
      connectStream: async () => undefined,
    }
    const front = new Reconnector({
      host: "h",
      open: async () => ({ connection, close: async () => {} }),
      failed: () => false,
      retryDelayMs: 0,
      now: () => 0,
    })
    for (let index = 0; index < MAX_HANDLES + 10; index++) {
      await front.request("process.prepare", {}, { parse: (value: unknown) => value })
    }
    expect(front.handleCount()).toBe(MAX_HANDLES)
  })
})
