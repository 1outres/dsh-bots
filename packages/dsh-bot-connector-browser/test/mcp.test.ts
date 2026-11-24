import { describe, expect, it } from "vitest"
import { createMcpClient, McpCallError, McpUnavailableError } from "../src/host/mcp/client"
import { parseCallResult, parseToolList } from "../src/host/mcp/protocol"
import { serverArgv } from "../src/host/mcp/server"
import { deadline, fakeProcess, settle } from "./support"

describe("the MCP client", () => {
  it("matches replies by id, answers the server's ping and refuses its other requests", async () => {
    const fake = fakeProcess()
    const client = createMcpClient(fake.process, { deadline }, { maxLineBytes: 1024 })
    const first = client.request("tools/list", {}, { timeoutMs: 1000 })
    const second = client.request("tools/call", { name: "x" }, { timeoutMs: 1000 })
    fake.push('{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"bad"}}\n')
    fake.push('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n')
    fake.push(
      '{"jsonrpc":"2.0","id":"p","method":"ping"}\n{"jsonrpc":"2.0","id":7,"method":"roots/list"}\n',
    )
    fake.push('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n')
    await expect(first).resolves.toEqual({ tools: [] })
    await expect(second).rejects.toThrow(McpCallError)
    await settle()
    expect(fake.written.slice(2)).toEqual([
      { jsonrpc: "2.0", id: "p", result: {} },
      { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "roots/list is not supported" } },
    ])
  })

  it("cancels an aborted request on the server and fails every call once the stream breaks", async () => {
    const fake = fakeProcess()
    const client = createMcpClient(fake.process, { deadline }, { maxLineBytes: 16 })
    const stop = new AbortController()
    const call = client.request("tools/call", {}, { timeoutMs: 1000, signal: stop.signal })
    stop.abort(new Error("stopped"))
    await expect(call).rejects.toThrow("stopped")
    expect(fake.written.at(-1)).toMatchObject({
      method: "notifications/cancelled",
      params: { requestId: 1 },
    })
    const open = client.request("tools/list", {}, { timeoutMs: 1000 })
    fake.push("x".repeat(40))
    await expect(open).rejects.toThrow(/longer than 16 bytes/)
    await expect(client.request("tools/list", {}, { timeoutMs: 1000 })).rejects.toThrow(/longer/)
  })

  it("says the server is gone when its output ends", async () => {
    const fake = fakeProcess()
    const client = createMcpClient(fake.process, { deadline }, { maxLineBytes: 1024 })
    const open = client.request("tools/list", {}, { timeoutMs: 1000 })
    fake.end()
    await expect(open).rejects.toThrow(McpUnavailableError)
  })
})

describe("what the server answers", () => {
  it("is checked", () => {
    expect(() => parseToolList({ tools: [{ name: "a" }] })).toThrow(/no description/)
    expect(() => parseToolList({ tools: [], nextCursor: "2" })).toThrow(/pages/)
    expect(parseCallResult({ content: [{ type: "text", text: "a" }] })).toEqual({
      content: [{ type: "text", text: "a" }],
      isError: false,
    })
    expect(() => parseCallResult({ content: [{ type: "resource" }] })).toThrow(/neither text/)
  })
})

describe("the server's command line", () => {
  it("attaches to the desktop's Chrome and links files by absolute paths the bot can read", () => {
    expect(
      serverArgv({ uid: 1001, name: "bot", home: "/home/bot" }, ["--caps", "vision,pdf"]),
    ).toEqual([
      "node",
      "/opt/dsh-browser/mcp/node_modules/@playwright/mcp/cli.js",
      "--caps",
      "vision,pdf",
      "--cdp-endpoint",
      "http://127.0.0.1:9222",
      "--codegen",
      "none",
      "--file-paths",
      "absolute",
      "--output-dir",
      "/home/bot/.cache/dsh-browser/output",
      "--output-max-size",
      String(256 << 20),
    ])
  })
})
