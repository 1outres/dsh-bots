import type { Context } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import { createConnectorsBackend } from "../src/host/connectors/backend"
import { createConnectorPanel } from "../src/host/connectors/panel"
import { createConnectorToolSurface } from "../src/host/connectors/tools"
import {
  CALL_CONNECTOR_TOOL,
  CONNECTOR_TOOL_AVAILABLE,
  type ConnectorToolDescription,
  WATCH_CONNECTOR_TOOLS,
} from "../src/internal"
import BotConnectorTools from "../src/plugins/connectors"
import { brokerSetup } from "./connectors-support"

async function backendSetup() {
  const setup = brokerSetup()
  setup.catalog.register(setup.connector)
  await setup.enable(setup.connector, ["b1"])
  const exists = (botId: string) => botId === "b1"
  const backend = createConnectorsBackend({
    ...setup,
    surface: createConnectorToolSurface(setup),
    panel: createConnectorPanel({ ...setup, exists }),
    exists,
    caller: (_botId, token, agentId) =>
      token !== "tok"
        ? { kind: "refused", reason: "stale revision" }
        : { kind: agentId === "main-1" ? "main" : "bot", sessionId: agentId },
  })
  return { ...setup, backend }
}

const signal = () => new AbortController().signal

describe("connectors backend", () => {
  it("refuses calls of another revision or session, and routes the rest", async () => {
    const { backend } = await backendSetup()
    const request = { agentId: "main-1", name: "mail_echo", args: { text: "hi" } }
    await expect(backend.callTool("b1", "old", request, signal())).rejects.toThrow("stale revision")
    await expect(
      backend.callTool("b1", "tok", { ...request, agentId: "sub" }, signal()),
    ).rejects.toThrow(/Main session/)
    await expect(
      backend.callTool("b1", "tok", { ...request, name: "mail_hidden" }, signal()),
    ).rejects.toThrow(/not available/)
    expect((await backend.callTool("b1", "tok", request, signal())).data).toEqual({
      status: "done",
      result: { echoed: "hi" },
    })
    expect(
      (
        await backend.callTool(
          "b1",
          "tok",
          { ...request, name: "connector_pending_list", args: {} },
          signal(),
        )
      ).data,
    ).toEqual({ actions: [] })
  })

  it("parses permission changes from outside, and offers no decision", async () => {
    const { backend } = await backendSetup()
    expect("answer" in backend).toBe(false)
    await expect(
      backend.setPermission("b1", {
        connectorId: "mail",
        tool: "send",
        permission: "sometimes",
      } as never),
    ).rejects.toThrow(/invalid permission change/)
    await expect(
      backend.setPermission("zz", { connectorId: "mail", tool: "send", permission: "allow" }),
    ).rejects.toThrow(/does not exist/)
    const list = await backend.setPermission("b1", {
      connectorId: "mail",
      tool: "send",
      permission: "allow",
    })
    expect(list.find((entry) => entry.tool === "send")?.effective).toBe("allow")
  })
})

describe("connectors row", () => {
  it("registers the bot's tools, follows changes and passes calls with its token", async () => {
    const { backend, permissions } = await backendSetup()
    const registered = new Map<
      string,
      { execute(args: unknown, exec: unknown): Promise<unknown> }
    >()
    const bot = {
      [WATCH_CONNECTOR_TOOLS]: backend.watchTools,
      [CONNECTOR_TOOL_AVAILABLE]: backend.toolAvailable,
      [CALL_CONNECTOR_TOOL]: backend.callTool,
    }
    let dispose: () => void = () => {}
    const ctx = {
      get: () => bot,
      tools: {
        register(
          definition: ConnectorToolDescription & {
            execute(args: unknown, exec: unknown): Promise<unknown>
          },
        ) {
          registered.set(definition.name, definition)
          return () => registered.delete(definition.name)
        },
      },
      effect(setup: () => () => void) {
        dispose = setup()
      },
    }
    new BotConnectorTools(ctx as unknown as Context, { botId: "b1", token: "tok" })
    expect([...registered.keys()]).toEqual([
      "mail_echo",
      "mail_send",
      "connector_pending_list",
      "connector_pending_cancel",
    ])
    const echo = registered.get("mail_echo")
    const result = await echo?.execute(
      { text: "hi" },
      { agent: { id: "main-1" }, signal: signal() },
    )
    expect(result).toMatchObject({ data: { status: "done" } })
    await permissions.set("b1", { connectorId: "mail", tool: "echo", permission: "disallow" })
    expect(registered.has("mail_echo")).toBe(false)
    dispose()
    expect(registered.size).toBe(0)
  })
})
