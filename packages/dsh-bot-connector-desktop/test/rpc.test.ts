import { SecretBytes } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { AgentCallError, AgentUnavailableError, createRpcClient } from "../src/host/agent/rpc"
import { VAULT_KIT } from "./support"

/** A byte stream the test writes the agent's side of. */
function stream() {
  const written: string[] = []
  const lines: Uint8Array[] = []
  const queue: Uint8Array[] = []
  let wake: (() => void) | undefined
  let ended = false
  const stdout: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const chunk = queue.shift()
        if (chunk !== undefined) {
          yield chunk
          continue
        }
        if (ended) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
  const push = (text: string | Uint8Array) => {
    queue.push(typeof text === "string" ? new TextEncoder().encode(text) : text)
    wake?.()
  }
  return {
    process: {
      stdin: {
        async write(data: Uint8Array) {
          written.push(new TextDecoder().decode(data))
          lines.push(data)
        },
        async end() {},
      },
      stdout,
    },
    written,
    lines,
    push,
    end() {
      ended = true
      wake?.()
    },
  }
}

const deps = { deadline: (ms: number) => AbortSignal.timeout(ms), vaultKit: VAULT_KIT }
const secretOf = (text: string) => SecretBytes.from(new TextEncoder().encode(text))

describe("the agent's JSON-RPC client", () => {
  it("matches replies to calls by id, across chunk boundaries", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    const first = rpc.call("status", {}, { timeoutMs: 1_000 })
    const second = rpc.call("cursor", {}, { timeoutMs: 1_000 })
    await Promise.resolve()
    expect(io.written.map((line) => JSON.parse(line).method)).toEqual(["status", "cursor"])
    io.push('{"jsonrpc":"2.0","id":2,"result":{"x":1}}\n{"jsonrpc":"2.0","id":1,')
    io.push('"result":{"ok":true}}\n')
    expect(await second).toEqual({ x: 1 })
    expect(await first).toEqual({ ok: true })
  })

  it("turns an error reply into the agent's code and message", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    const call = rpc.call("act", {}, { timeoutMs: 1_000 })
    io.push(
      '{"jsonrpc":"2.0","id":1,"error":{"code":"stale_element","message":"take a new tree"}}\n',
    )
    await expect(call).rejects.toEqual(new AgentCallError("stale_element", "take a new tree"))
  })

  it("fails every open call and every later one when the stream ends", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    const call = rpc.call("status", {}, { timeoutMs: 1_000 })
    io.end()
    await expect(call).rejects.toBeInstanceOf(AgentUnavailableError)
    await rpc.closed
    await expect(rpc.call("status", {}, { timeoutMs: 1_000 })).rejects.toThrow(/connection ended/)
  })

  it("gives up on a line longer than the limit", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 16 })
    const call = rpc.call("status", {}, { timeoutMs: 1_000 })
    io.push("x".repeat(64))
    await expect(call).rejects.toThrow(/longer than 16 bytes/)
  })

  it("gives up on a reply that is not JSON or not a reply", async () => {
    for (const line of ["not json\n", '{"id":"1","result":1}\n']) {
      const io = stream()
      const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
      const call = rpc.call("status", {}, { timeoutMs: 1_000 })
      io.push(line)
      await expect(call).rejects.toThrow()
    }
  })

  it("fails a call that takes longer than its time", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    await expect(rpc.call("launch", {}, { timeoutMs: 20 })).rejects.toThrow(/longer than 20 ms/)
    const late = rpc.call("status", {}, { timeoutMs: 1_000 })
    io.push(
      '{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","id":2,"result":{"late":false}}\n',
    )
    expect(await late).toEqual({ late: false })
  })

  it("sends a secret as base64 in the request's own member, then wipes the line and the secret", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    const secret = secretOf('p"ä\\ss')
    const call = rpc.callSecret("type_secret", { token: "t", submit: true }, secret, {
      timeoutMs: 1_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const request = JSON.parse(io.written[0] ?? "")
    expect(request).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "type_secret",
      params: { token: "t", submit: true },
      secret: Buffer.from('p"ä\\ss').toString("base64"),
    })
    expect(io.written[0]?.endsWith("}\n")).toBe(true)
    expect(io.lines[0]?.every((byte) => byte === 0)).toBe(true)
    expect(secret.spent).toBe(true)
    io.push('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n')
    expect(await call).toEqual({ ok: true })
  })

  it("wipes the secret when the call cannot be sent", async () => {
    const io = stream()
    const rpc = createRpcClient(io.process, deps, { maxLineBytes: 1024 })
    io.end()
    await rpc.closed
    const secret = secretOf("hunter22")
    await expect(
      rpc.callSecret("type_secret", {}, secret, { timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(AgentUnavailableError)
    expect(secret.spent).toBe(true)
    expect(io.written).toEqual([])
  })
})
