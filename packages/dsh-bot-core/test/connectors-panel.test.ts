import { describe, expect, it, vi } from "vitest"
import { createConnectorPanel } from "../src/host/connectors/panel"
import { brokerSetup, mailConnector } from "./connectors-support"

const setup = () => {
  const broker = brokerSetup()
  const panel = createConnectorPanel({ ...broker, exists: (botId) => botId !== "nobody" })
  return { ...broker, panel }
}

describe("connector panel", () => {
  it("tells its watchers about a connector registered or unregistered, and stops on dispose", () => {
    const { catalog, panel } = setup()
    const heard = vi.fn()
    const off = panel.subscribe(heard)
    expect(panel.views("b1")).toEqual([])
    const unregister = catalog.register(mailConnector())
    expect(heard).toHaveBeenCalled()
    expect(panel.views("b1").map((view) => view.connector.id)).toEqual(["mail"])
    heard.mockClear()
    unregister()
    expect(heard).toHaveBeenCalled()
    expect(panel.views("b1")).toEqual([])
    off()
    heard.mockClear()
    catalog.register(mailConnector())
    expect(heard).not.toHaveBeenCalled()
  })

  it("tells its watchers about settings and permission changes", async () => {
    const { catalog, panel } = setup()
    catalog.register(mailConnector())
    const heard = vi.fn()
    panel.subscribe(heard)
    const view = await panel.configure("b1", "mail", { enabled: true, values: {} })
    expect(view.enabled).toBe(true)
    expect(view.readiness.state).toBe("ready")
    expect(heard).toHaveBeenCalled()
    heard.mockClear()
    const tool = view.connector.tools[0]?.name ?? ""
    const changed = await panel.setPermission("b1", {
      connectorId: "mail",
      tool,
      permission: "disallow",
    })
    expect(heard).toHaveBeenCalled()
    expect(changed.permissions.find((entry) => entry.tool === tool)).toMatchObject({
      override: "disallow",
      effective: "disallow",
    })
  })

  it("shows what a connector requires and refuses switches that leave a requirement off", async () => {
    const { catalog, panel } = setup()
    catalog.register({ ...mailConnector(), id: "base", name: "Base" })
    catalog.register({ ...mailConnector(), id: "top", name: "Top", requires: ["base"] })
    expect(panel.views("b1").map((view) => [view.connector.id, view.connector.requires])).toEqual([
      ["base", []],
      ["top", ["base"]],
    ])
    await expect(panel.configure("b1", "top", { enabled: true, values: {} })).rejects.toThrow(
      "turn on Base first: Top needs it",
    )
    await panel.configure("b1", "base", { enabled: true, values: {} })
    await panel.configure("b1", "top", { enabled: true, values: {} })
    await expect(panel.configure("b1", "base", { enabled: false, values: {} })).rejects.toThrow(
      "turn off Top first: it needs Base",
    )
    expect(panel.views("b1").map((view) => view.enabled)).toEqual([true, true])
  })

  it("lists every tool's description and default for the browser", () => {
    const { catalog, panel } = setup()
    catalog.register(mailConnector())
    const [view] = panel.views("b1")
    for (const tool of view?.connector.tools ?? []) {
      expect(tool.toolName).toBe(`mail_${tool.name}`)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(view?.permissions.find((entry) => entry.tool === tool.name)?.default).toBe(
        tool.permission,
      )
    }
    expect(() => panel.views("nobody")).toThrow(/does not exist/)
  })
})
