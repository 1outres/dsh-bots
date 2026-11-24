import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  ConnectorPanelView,
  type RenderShellSlot,
} from "../src/client/connector-panels/ConnectorPanel"
import type { ConnectorsFeed } from "../src/client/connectors-hub"
import type { BotConnectorView, ConnectorReadiness } from "../src/shared/connectors"
import { bot, t } from "./support/client"
import { probeView } from "./support/connectors-client"

function desktopView(readiness: ConnectorReadiness): BotConnectorView {
  const plain = probeView()
  return {
    ...plain,
    connector: {
      ...plain.connector,
      id: "desktop",
      panel: { title: { en: "Desktop" }, icon: "desktop", streams: ["screen"] },
    },
    readiness,
    status: { note: { en: "A person is operating" } },
  }
}

const feedOf = (view: BotConnectorView): ConnectorsFeed => ({
  getSnapshot: () => ({ status: "ready", snapshot: { botId: "x", connectors: [view] } }),
  subscribe: () => () => {},
  configure: vi.fn(),
  setPermission: vi.fn(),
  retry: vi.fn(),
})

function render(readiness: ConnectorReadiness, renderSlot: RenderShellSlot = () => null) {
  return renderToStaticMarkup(
    createElement(ConnectorPanelView, {
      t,
      text: (value) => value.en,
      bot: bot("x", "m1"),
      sessionId: "m1",
      connectorId: "desktop",
      feed: feedOf(desktopView(readiness)),
      width: { getSnapshot: () => 720, subscribe: () => () => {}, resize: () => {} },
      containerRef: { current: null },
      renderSlot,
      openStream: () => {
        throw new Error("not opened")
      },
      openSettings: () => {},
      close: () => {},
    }),
  )
}

describe("ConnectorPanelView", () => {
  it("frames the connector with its title and note", () => {
    const html = render({ state: "disabled" })
    expect(html).toContain("Desktop")
    expect(html).toContain("A person is operating")
  })

  it("shows the readiness until the connector is ready", () => {
    expect(render({ state: "disabled" })).toContain("connectorPanel.disabled(Desktop)")
    expect(render({ state: "disabled" })).toContain("connectorPanel.openSettings")
    const unavailable = render({
      state: "unavailable",
      cause: "environment",
      reason: "the VM is stopped",
    })
    expect(unavailable).toContain("the VM is stopped")
    expect(unavailable).toContain("connectorPanel.unavailable.environment(Desktop)")
    expect(
      render({ state: "unavailable", cause: "requirements", reason: "needs Desktop" }),
    ).toContain("connectorPanel.unavailable.requirements(Desktop)")
    const running = render({
      state: "preparing",
      since: 1,
      stage: { kind: "running", step: "installing packages", since: 1 },
    })
    expect(running).toContain("installing packages")
    expect(running).toContain("connectors.preparing.elapsed(")
    expect(
      render({
        state: "preparing",
        since: 1,
        stage: { kind: "requirements", connectors: ["Desktop"], since: 1 },
      }),
    ).toContain("connectors.stage.requirements(Desktop)")
    const failed = render({ state: "failed", reason: "apt broke", at: 1 })
    expect(failed).toContain("apt broke")
    expect(failed).toContain("connectorPanel.retry")
  })

  it("renders the connector's body once ready, keyed by its id, with the missing note as fallback", () => {
    const renderSlot = vi.fn<RenderShellSlot>((_key, owner, options) =>
      createElement("div", { "data-body": owner.connector.connector.id }, options.fallback),
    )
    const html = render({ state: "ready", since: 1 }, renderSlot)
    expect(renderSlot).toHaveBeenCalledWith(
      "bot-core.connector.panel",
      expect.objectContaining({ botId: "x", sessionId: "m1" }),
      expect.objectContaining({ entryKey: "desktop" }),
    )
    expect(html).toContain('data-body="desktop"')
    expect(html).toContain("connectorPanel.missing(Desktop)")
  })
})
