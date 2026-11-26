import { describe, expect, it } from "vitest"
import {
  type ByteChannel,
  createIncusClient,
  type IncusResponse,
  type IncusTransport,
} from "../src/host/incus"

type Call = { method: string; path: string; body?: unknown }

/** A channel that records what is written and yields `incoming`. */
export function memoryChannel(incoming: readonly string[] = []) {
  const written: string[] = []
  let ended = false
  let destroyed = false
  const channel: ByteChannel = {
    async *[Symbol.asyncIterator]() {
      for (const text of incoming) yield new TextEncoder().encode(text)
    },
    write: async (data) => {
      written.push(new TextDecoder().decode(data))
    },
    end: async () => {
      ended = true
    },
    destroy: () => {
      destroyed = true
    },
  }
  return { channel, written, ended: () => ended, destroyed: () => destroyed }
}

function transport(
  responses: Record<string, IncusResponse | IncusResponse[]>,
  sockets: Record<string, ByteChannel> = {},
) {
  const calls: Call[] = []
  const answer = (method: string, path: string, body?: unknown): IncusResponse => {
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    const entry = responses[`${method} ${path}`]
    const response = Array.isArray(entry) ? entry.shift() : entry
    if (response === undefined)
      return { status: 404, body: { type: "error", error: "not found", error_code: 404 } }
    return response
  }
  const send: IncusTransport = {
    json: async (method, path, body) => answer(method, path, body),
    upload: async (path, body, headers) => {
      let bytes = 0
      for await (const chunk of body) bytes += chunk.length
      return answer("POST", path, { bytes, headers })
    },
    websocket: async (path) => {
      calls.push({ method: "WS", path })
      const socket = sockets[path]
      if (socket === undefined) throw new Error(`no websocket ${path}`)
      return socket
    },
  }
  return { calls, send }
}

const sync = (metadata: unknown): IncusResponse => ({
  status: 200,
  body: { type: "sync", metadata },
})
const operation = (id: string): IncusResponse => ({
  status: 202,
  body: { type: "async", operation: `/1.0/operations/${id}` },
})
const done = (status = "Success", err = ""): IncusResponse => sync({ status, err })

describe("createIncusClient", () => {
  it("reports a missing instance as undefined", async () => {
    const { send } = transport({})
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    expect(await client.instance("dsh-bot-x")).toBeUndefined()
  })

  it("updates an instance by writing its whole config and devices back", async () => {
    const current = {
      name: "dsh-bot-x",
      status: "Stopped",
      architecture: "x86_64",
      description: "dsh bot x",
      ephemeral: false,
      stateful: false,
      profiles: ["dsh-bot"],
      config: { "limits.memory": "4096MiB", "volatile.vsock_id": "7" },
      expanded_config: { "limits.memory": "4096MiB", "limits.cpu": "2" },
      devices: { workspace: { type: "disk", source: "/old", path: "/w" } },
    }
    const { calls, send } = transport({
      "GET /1.0/instances/dsh-bot-x?project=bots": sync(current),
      "PUT /1.0/instances/dsh-bot-x?project=bots": sync({}),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await client.update("dsh-bot-x", {
      config: { "raw.idmap": "uid 1000 1001\ngid 1000 1001", "limits.memory": "6144MiB" },
      devices: { workspace: { type: "disk", source: "/s", path: "/w" } },
    })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /1.0/instances/dsh-bot-x?project=bots",
      "PUT /1.0/instances/dsh-bot-x?project=bots",
    ])
    expect(calls[1]?.body).toEqual({
      architecture: "x86_64",
      description: "dsh bot x",
      ephemeral: false,
      stateful: false,
      profiles: ["dsh-bot"],
      config: {
        "limits.memory": "6144MiB",
        "volatile.vsock_id": "7",
        "raw.idmap": "uid 1000 1001\ngid 1000 1001",
      },
      devices: { workspace: { type: "disk", source: "/s", path: "/w" } },
    })
  })

  it("refuses to write an instance back without its profiles", async () => {
    const { calls, send } = transport({
      "GET /1.0/instances/a?project=bots": sync({
        name: "a",
        status: "Stopped",
        config: {},
        devices: {},
      }),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.update("a", { config: { "limits.cpu": "2" } })).rejects.toThrow(
      "writable fields",
    )
    expect(calls.map((call) => call.method)).toEqual(["GET"])
  })

  it("reads the Host's CPUs and memory, the project's config, a profile and a pool's size", async () => {
    const { send } = transport({
      "GET /1.0/resources?project=bots": sync({ cpu: { total: 8 }, memory: { total: 2 ** 36 } }),
      "GET /1.0/projects/bots?project=bots": sync({ config: { "limits.memory": "56GiB" } }),
      "GET /1.0/profiles/dsh-bot?project=bots": sync({
        name: "dsh-bot",
        devices: { root: { type: "disk", path: "/", pool: "dsh" } },
      }),
      "GET /1.0/storage-pools/dsh/resources?project=bots": sync({ space: { total: 2 ** 37 } }),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.hostResources()).resolves.toEqual({ cpus: 8, memoryBytes: 2 ** 36 })
    await expect(client.projectConfig()).resolves.toEqual({ "limits.memory": "56GiB" })
    await expect(client.profile("dsh-bot")).resolves.toMatchObject({
      devices: { root: { pool: "dsh" } },
    })
    await expect(client.poolSpace("dsh")).resolves.toBe(2 ** 37)
  })

  it("creates a VM from an image alias and waits for the operation", async () => {
    const { calls, send } = transport({
      "POST /1.0/instances?project=bots": operation("op1"),
      "GET /1.0/operations/op1/wait?timeout=30&project=bots": sync({ status: "Running" }),
      "GET /1.0/operations/op1/wait?timeout=10&project=bots": done(),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 40_000,
      requestTimeoutMs: 5_000,
    })
    await client.create({
      name: "dsh-bot-x",
      image: "dsh-bot-base",
      profiles: ["dsh-bot"],
      config: { "boot.autostart": "true" },
      devices: {},
      start: true,
    })
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/1.0/instances?project=bots",
      body: {
        name: "dsh-bot-x",
        description: "",
        type: "virtual-machine",
        source: { type: "image", alias: "dsh-bot-base" },
        profiles: ["dsh-bot"],
        config: { "boot.autostart": "true" },
        devices: {},
        start: true,
      },
    })
    expect(calls.map((call) => call.path)).toEqual([
      "/1.0/instances?project=bots",
      "/1.0/operations/op1/wait?timeout=30&project=bots",
      "/1.0/operations/op1/wait?timeout=10&project=bots",
    ])
  })

  it("keeps waiting when Incus reports the wait deadline of a running operation", async () => {
    const { send } = transport({
      "PUT /1.0/instances/a/state?project=bots": operation("op3"),
      "GET /1.0/operations/op3/wait?timeout=30&project=bots": [
        {
          status: 500,
          body: { type: "error", error: "context deadline exceeded", error_code: 500 },
        },
        done(),
      ],
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
    })
    await client.setState("a", "start")
  })

  it("surfaces a failed operation", async () => {
    const { send } = transport({
      "PUT /1.0/instances/a/state?project=bots": operation("op2"),
      "GET /1.0/operations/op2/wait?timeout=5&project=bots": done("Failure", "no space"),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.setState("a", "start")).rejects.toThrow("Incus start a failed: no space")
  })

  it("stops a running instance before deleting it and ignores a missing one", async () => {
    const { calls, send } = transport({
      "GET /1.0/instances/a?project=bots": sync({
        name: "a",
        status: "Running",
        config: {},
        devices: {},
      }),
      "PUT /1.0/instances/a/state?project=bots": operation("s"),
      "GET /1.0/operations/s/wait?timeout=5&project=bots": done(),
      "DELETE /1.0/instances/a?project=bots": operation("d"),
      "GET /1.0/operations/d/wait?timeout=5&project=bots": done(),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await client.destroy("a")
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /1.0/instances/a?project=bots",
      "PUT /1.0/instances/a/state?project=bots",
      "GET /1.0/operations/s/wait?timeout=5&project=bots",
      "DELETE /1.0/instances/a?project=bots",
      "GET /1.0/operations/d/wait?timeout=5&project=bots",
    ])
    expect(calls[1]?.body).toEqual({ action: "stop", force: true })
    await client.destroy("missing")
  })

  it("names the request in an API error", async () => {
    const { send } = transport({
      "GET /1.0/instances/a?project=bots": {
        status: 403,
        body: { type: "error", error: "not authorized", error_code: 403 },
      },
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.instance("a")).rejects.toThrow(
      "Incus GET /1.0/instances/a failed (403): not authorized",
    )
  })

  it("asks the server unscoped who it takes the client for", async () => {
    const { calls, send } = transport({
      "GET /1.0": sync({
        auth: "trusted",
        api_extensions: ["instances"],
        environment: { server_version: "6.0.4", driver: "lxc | qemu" },
      }),
      "POST /1.0/certificates": sync({}),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.server()).resolves.toEqual({
      auth: "trusted",
      apiExtensions: ["instances"],
      serverVersion: "6.0.4",
      drivers: ["lxc", "qemu"],
    })
    await client.trustWithToken("tok")
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /1.0",
      "POST /1.0/certificates",
    ])
    expect(calls[1]?.body).toEqual({ type: "client", trust_token: "tok" })
  })

  it("runs a command with its streams on the operation's websockets", async () => {
    const control = memoryChannel()
    const stdin = memoryChannel()
    const stdout = memoryChannel(["hello"])
    const stderr = memoryChannel()
    const ws = (fd: string) => `/1.0/operations/e1/websocket?secret=s-${fd}&project=bots`
    const { calls, send } = transport(
      {
        "POST /1.0/instances/vm/exec?project=bots": {
          status: 202,
          body: {
            type: "async",
            operation: "/1.0/operations/e1",
            metadata: {
              metadata: { fds: { "0": "s-0", "1": "s-1", "2": "s-2", control: "s-control" } },
            },
          },
        },
        "GET /1.0/operations/e1/wait?timeout=5&project=bots": sync({
          status: "Success",
          metadata: { return: 3 },
        }),
      },
      {
        [ws("control")]: control.channel,
        [ws("0")]: stdin.channel,
        [ws("1")]: stdout.channel,
        [ws("2")]: stderr.channel,
      },
    )
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    const session = await client.exec("vm", {
      command: ["/usr/sbin/sshd", "-i"],
      user: 0,
      group: 0,
      environment: {},
    })
    expect(calls[0]?.body).toEqual({
      command: ["/usr/sbin/sshd", "-i"],
      environment: {},
      "wait-for-websocket": true,
      interactive: false,
      "record-output": false,
      user: 0,
      group: 0,
    })
    const out: string[] = []
    for await (const chunk of session.stdout) out.push(new TextDecoder().decode(chunk))
    expect(out).toEqual(["hello"])
    await session.stdin.write(new TextEncoder().encode("in"))
    await session.stdin.end()
    expect(stdin.written).toEqual(["in"])
    expect(stdin.ended()).toBe(true)
    await session.signal(15)
    expect(control.written).toEqual(['{"command":"signal","signal":15}'])
    await expect(session.exitCode()).resolves.toBe(3)
    session.destroy()
    expect([control, stdin, stdout, stderr].every((socket) => socket.destroyed())).toBe(true)
  })

  it("closes the websockets it opened when another fails", async () => {
    const control = memoryChannel()
    const { send } = transport(
      {
        "POST /1.0/instances/vm/exec?project=bots": {
          status: 202,
          body: {
            type: "async",
            operation: "/1.0/operations/e2",
            metadata: { metadata: { fds: { "0": "a", "1": "b", "2": "c", control: "d" } } },
          },
        },
      },
      { "/1.0/operations/e2/websocket?secret=d&project=bots": control.channel },
    )
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(
      client.exec("vm", { command: ["true"], user: 0, group: 0, environment: {} }),
    ).rejects.toThrow("no websocket")
    expect(control.destroyed()).toBe(true)
  })

  it("creates, resizes, lists and deletes custom volumes", async () => {
    const volume = {
      name: "w",
      content_type: "block",
      config: { size: "10GiB", "user.dsh-bot.id": "x" },
      used_by: ["/1.0/instances/vm"],
    }
    const { calls, send } = transport({
      "POST /1.0/storage-pools/dsh/volumes/custom?project=bots": sync({}),
      "PATCH /1.0/storage-pools/dsh/volumes/custom/w?project=bots": sync({}),
      "GET /1.0/storage-pools/dsh/volumes/custom/w?project=bots": sync(volume),
      "GET /1.0/storage-pools/dsh/volumes/custom?recursion=1&project=bots": sync([volume]),
      "DELETE /1.0/storage-pools/dsh/volumes/custom/w?project=bots": [
        sync({}),
        { status: 404, body: { type: "error", error: "not found", error_code: 404 } },
      ],
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await client.createVolume({
      pool: "dsh",
      name: "w",
      contentType: "block",
      config: { size: "10GiB" },
    })
    expect(calls[0]?.body).toEqual({
      name: "w",
      type: "custom",
      content_type: "block",
      description: "",
      config: { size: "10GiB" },
    })
    await client.patchVolume("dsh", "w", { size: "12GiB" })
    expect(calls[1]?.body).toEqual({ config: { size: "12GiB" } })
    const expected = {
      name: "w",
      contentType: "block",
      config: volume.config,
      usedBy: ["/1.0/instances/vm"],
    }
    await expect(client.volume("dsh", "w")).resolves.toEqual(expected)
    await expect(client.volume("dsh", "missing")).resolves.toBeUndefined()
    await expect(client.volumes("dsh")).resolves.toEqual([expected])
    await client.deleteVolume("dsh", "w")
    await client.deleteVolume("dsh", "w")
  })

  it("imports an image and points an alias at it", async () => {
    const { calls, send } = transport({
      "POST /1.0/images?project=bots": operation("i1"),
      "GET /1.0/operations/i1/wait?timeout=5&project=bots": sync({
        status: "Success",
        metadata: { fingerprint: "f".repeat(64) },
      }),
      "GET /1.0/images/aliases/base?project=bots": [
        { status: 404, body: { type: "error", error: "not found", error_code: 404 } },
        sync({ name: "base", target: "f".repeat(64) }),
      ],
      "POST /1.0/images/aliases?project=bots": sync({}),
    })
    const client = createIncusClient({
      transport: send,
      project: "bots",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    async function* body() {
      yield new Uint8Array(3)
      yield new Uint8Array(4)
    }
    await expect(client.importImage(body(), { timeoutMs: 5_000 })).resolves.toBe("f".repeat(64))
    expect(calls[0]?.body).toEqual({
      bytes: 7,
      headers: { "Content-Type": "application/octet-stream" },
    })
    await client.setAlias("base", "f".repeat(64))
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/1.0/images/aliases?project=bots",
      body: { name: "base", target: "f".repeat(64), description: "" },
    })
    await expect(client.alias("base")).resolves.toBe("f".repeat(64))
  })
})
