import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ConnectorRequests, requestsOf } from "../src/client/connector-panels/ConnectorRequests"
import { connectorEntries } from "../src/client/connector-panels/entries"
import { CONNECTOR_PANEL_GLYPHS } from "../src/client/connector-panels/icons"
import { openConnectorStream } from "../src/client/connector-panels/stream"
import type { RemoteMount } from "../src/client/remote"
import { ACTIONS_PANEL, connectorPanel, createSidePanels } from "../src/client/shell/side-panels"
import { createViewer } from "../src/client/viewer"
import type { BotConnectorView, ConnectorJson } from "../src/shared/connectors"
import { bot, t } from "./support/client"
import { probeView } from "./support/connectors-client"

describe("side panels", () => {
  it("show one side panel per session: Actions or a connector's closes the files, the files close it", () => {
    const viewer = createViewer()
    const panels = createSidePanels(viewer)
    const desktop = connectorPanel("desktop")
    viewer.browse("s1")
    panels.open("s1", desktop)
    expect(viewer.of("s1").open).toBe(false)
    expect(panels.of("s1")).toEqual(desktop)
    panels.open("s1", ACTIONS_PANEL)
    expect(panels.of("s1")).toEqual(ACTIONS_PANEL)
    viewer.toggle("s1")
    expect(panels.of("s1")).toBeUndefined()
    panels.toggle("s2", desktop)
    panels.toggle("s2", connectorPanel("desktop"))
    expect(panels.of("s2")).toBeUndefined()
    panels.open("s3", desktop)
    panels.forget((sessionId) => sessionId !== "s3")
    expect(panels.getSnapshot()).toEqual({})
    panels.dispose()
  })

  it("give a menu bar button, with its own glyph, to each connector on with a panel, with a dot while it requests", () => {
    const panels = createSidePanels(createViewer())
    const plain = probeView()
    const screen: BotConnectorView = {
      ...plain,
      connector: {
        ...plain.connector,
        id: "desktop",
        panel: { title: { en: "Desktop" }, icon: "desktop", streams: ["screen"] },
      },
      readiness: { state: "ready", since: 1 },
      status: { request: { id: "r", reason: "log in", since: 1 } },
    }
    const off: BotConnectorView = {
      ...screen,
      connector: { ...screen.connector, id: "browser" },
      readiness: { state: "disabled" },
    }
    const entries = connectorEntries([plain, screen, off], panels, (text) => text.en)
    expect(entries.map((entry) => entry.id)).toEqual(["connector:desktop"])
    const [entry] = entries
    if (entry === undefined) throw new Error("no entry")
    expect(entry.icon).toBe(CONNECTOR_PANEL_GLYPHS.desktop)
    const context = { bot: bot("x", "m1"), sessionId: "m1" }
    expect(entry.label(t, context.bot)).toBe("shell.connector(Desktop,Bot x)")
    expect(entry.attention?.(context).getSnapshot()).toBe(true)
    const pressed = entry.pressed?.(context)
    expect(pressed?.getSnapshot()).toBe(false)
    entry.run(context, {} as HTMLElement)
    expect(pressed?.getSnapshot()).toBe(true)
  })
})

describe("openConnectorStream", () => {
  it("queues what is sent before the Remote is mounted and never opens once disposed", async () => {
    const sent: ConnectorJson[] = []
    const handle = {
      send: vi.fn((item: ConnectorJson) => sent.push(item)),
      end: vi.fn(),
      dispose: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield { hello: true }
      },
    }
    const open = vi.fn(() => handle)
    const mount = Promise.resolve({
      status: "mounted",
      remote: { botConnectorStreams: { open } },
    } as unknown as RemoteMount)
    const stream = openConnectorStream(mount, "b1", "desktop", "screen")
    stream.send({ type: "take" })
    const items: ConnectorJson[] = []
    for await (const item of stream) items.push(item)
    expect(open).toHaveBeenCalledWith("b1", "desktop", "screen")
    expect(sent).toEqual([{ type: "take" }])
    expect(items).toEqual([{ hello: true }])
    stream.dispose()
    expect(handle.dispose).toHaveBeenCalled()
    expect(() => stream.send({})).toThrow(/closed/)

    const early = openConnectorStream(mount, "b1", "desktop", "screen")
    early.dispose()
    await mount
    await Promise.resolve()
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe("connector requests", () => {
  it("list what a connector asks of a person, its reason as text, with a button that opens its panel", () => {
    const plain = probeView()
    const asking: BotConnectorView = {
      ...plain,
      connector: {
        ...plain.connector,
        id: "desktop",
        panel: { title: { en: "Desktop" }, icon: "desktop", streams: ["screen"] },
      },
      status: { request: { id: "r1", reason: "<b>log in</b>", since: 1 } },
    }
    const requests = requestsOf(
      { status: "ready", snapshot: { botId: "x", connectors: [plain, asking] } },
      (text) => text.en,
    )
    expect(requests).toEqual([
      { connectorId: "desktop", title: "Desktop", icon: "desktop", request: asking.status.request },
    ])
    expect(requestsOf({ status: "loading" }, (text) => text.en)).toEqual([])
    const opened: unknown[] = []
    const html = renderToStaticMarkup(
      createElement(ConnectorRequests, {
        t,
        sessionId: "m1",
        requests,
        panels: { open: (...args: unknown[]) => opened.push(args) },
      }),
    )
    expect(html).toContain('data-dshb-connector-requests=""')
    expect(html).toContain("&lt;b&gt;log in&lt;/b&gt;")
    expect(html).toContain('data-dshb-connector-request-open="desktop"')
    expect(html).toContain("connectorRequest.open(Desktop)")
    expect(
      renderToStaticMarkup(
        createElement(ConnectorRequests, {
          t,
          sessionId: "m1",
          requests: [],
          panels: { open() {} },
        }),
      ),
    ).toBe("")
  })
})
