import { describe, expect, it } from "vitest"
import { createIncusClient, type IncusResponse, type IncusTransport } from "../src/host/incus"

type Call = { method: string; path: string; body?: unknown }

function transport(responses: Record<string, IncusResponse | IncusResponse[]>) {
  const calls: Call[] = []
  const send: IncusTransport = async (method, path, body) => {
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    const entry = responses[`${method} ${path}`]
    const response = Array.isArray(entry) ? entry.shift() : entry
    if (response === undefined)
      return { status: 404, body: { type: "error", error: "not found", error_code: 404 } }
    return response
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
      project: "default",
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
      "GET /1.0/instances/dsh-bot-x": sync(current),
      "PUT /1.0/instances/dsh-bot-x": sync({}),
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await client.update("dsh-bot-x", {
      config: { "raw.idmap": "uid 1000 1001\ngid 1000 1001", "limits.memory": "6144MiB" },
      devices: { workspace: { type: "disk", source: "/s", path: "/w" } },
    })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /1.0/instances/dsh-bot-x",
      "PUT /1.0/instances/dsh-bot-x",
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
      "GET /1.0/instances/a": sync({ name: "a", status: "Stopped", config: {}, devices: {} }),
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
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
      "POST /1.0/instances": operation("op1"),
      "GET /1.0/operations/op1/wait?timeout=30": sync({ status: "Running" }),
      "GET /1.0/operations/op1/wait?timeout=10": done(),
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
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
      path: "/1.0/instances",
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
      "/1.0/instances",
      "/1.0/operations/op1/wait?timeout=30",
      "/1.0/operations/op1/wait?timeout=10",
    ])
  })

  it("keeps waiting when Incus reports the wait deadline of a running operation", async () => {
    const { send } = transport({
      "PUT /1.0/instances/a/state": operation("op3"),
      "GET /1.0/operations/op3/wait?timeout=30": [
        {
          status: 500,
          body: { type: "error", error: "context deadline exceeded", error_code: 500 },
        },
        done(),
      ],
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
      operationTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
    })
    await client.setState("a", "start")
  })

  it("surfaces a failed operation", async () => {
    const { send } = transport({
      "PUT /1.0/instances/a/state": operation("op2"),
      "GET /1.0/operations/op2/wait?timeout=5": done("Failure", "no space"),
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
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
      "GET /1.0/instances/a": {
        status: 403,
        body: { type: "error", error: "not authorized", error_code: 403 },
      },
    })
    const client = createIncusClient({
      transport: send,
      project: "default",
      operationTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    })
    await expect(client.instance("a")).rejects.toThrow(
      "Incus GET /1.0/instances/a failed (403): not authorized",
    )
  })
})
