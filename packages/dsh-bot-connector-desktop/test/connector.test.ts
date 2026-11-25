import { describe, expect, it } from "vitest"
import { createDesktopConnector } from "../src/host/connector"
import { DesktopControl } from "../src/host/control"
import { readVmSources } from "../src/index"
import { VAULT_KIT } from "./support"

/** docs/specs/bot-connectors.md, 9: the desktop's tools (bot-core's connectors-fit test registers the connector in its catalog). */
const SPEC_TOOLS = [
  "screenshot",
  "click",
  "move",
  "drag",
  "mouse_down",
  "mouse_up",
  "scroll",
  "type",
  "key",
  "hold_key",
  "cursor_position",
  "windows",
  "focus_window",
  "clipboard_get",
  "clipboard_set",
  "launch",
  "tree",
  "find",
  "act",
  "text",
  "sheet",
  "request_handoff",
  // docs/specs/bot-vaults.md, 9
  "type_credential",
]

async function connector() {
  return createDesktopConnector({
    sources: await readVmSources(),
    control: new DesktopControl(() => 0),
    deadline: (ms) => AbortSignal.timeout(ms),
    vaultKit: VAULT_KIT,
    now: () => 0,
  })
}

describe("the desktop connector", () => {
  it("has the spec's tools, every one allowed and serialized on the display but the handoff", async () => {
    const { tools } = await connector()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...SPEC_TOOLS].sort())
    expect(tools.filter((tool) => tool.vault === true).map((tool) => tool.name)).toEqual([
      "type_credential",
    ])
    expect(tools.every((tool) => tool.permission === "allow")).toBe(true)
    expect(tools.filter((tool) => tool.exclusive !== "display").map((tool) => tool.name)).toEqual([
      "request_handoff",
    ])
  })

  it("has a Desktop panel with the screen stream, and the control's status", async () => {
    const desktop = await connector()
    expect(desktop.panel?.title.en).toBe("Desktop")
    expect(desktop.panel?.streams.map((stream) => stream.name)).toEqual(["screen"])
    expect(desktop.status?.read("b1")).toEqual({})
  })

  it("runs in every session of the bot and needs a VM with 4 GiB of memory", async () => {
    const desktop = await connector()
    expect(desktop.id).toBe("desktop")
    expect(desktop.sessions).toBe("bot")
    expect(desktop.minimumSpec).toEqual({ memoryMiB: 4096 })
    const field = desktop.settings?.[0]
    expect(field?.default).toBe("1280x1024")
    expect(field?.kind === "choice" && field.options.map((option) => option.value)).toEqual([
      "1280x1024",
      "1280x800",
    ])
  })

  it("previews every tool from its arguments alone", async () => {
    const { tools } = await connector()
    for (const tool of tools) {
      const preview = tool.preview(
        { text: "こんにちは", keys: ["ctrl+s"], action: "write" } as never,
        undefined,
      )
      expect(preview.title.length).toBeGreaterThan(0)
    }
  })

  it("tells the model to read the tree before taking a screenshot", async () => {
    const { tools } = await connector()
    const description = (name: string) =>
      tools.find((tool) => tool.name === name)?.description ?? ""
    expect(description("tree")).toMatch(/before any screenshot/)
    expect(description("screenshot")).toMatch(/Prefer desktop_tree/)
  })
})
