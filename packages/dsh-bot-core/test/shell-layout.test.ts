import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ConnectorPreparing } from "../src/client/connector-preparing"
import { CHAT_MIN_WIDTH, MENU_BAR_WIDTH, panelLayout } from "../src/client/shell/panel-layout"
import { ShellMenuButton } from "../src/client/shell/ShellMenuBar"
import { Banner } from "../src/client/shell/ShellNotice"
import { createSidePanels } from "../src/client/shell/side-panels"
import { builtinShellEntries } from "../src/client/shell-menu"
import { EmptyState, NavRow } from "../src/client/ui"
import { createViewer } from "../src/client/viewer"
import { idleApprovals, idleConnectorPanels, idleInquiries, t, value } from "./support/client"

describe("side panel layout", () => {
  const wide = CHAT_MIN_WIDTH + MENU_BAR_WIDTH + 420

  it("sits beside the chat while the chat keeps 640px, over it otherwise", () => {
    expect(panelLayout({ shellWidth: wide, panelWidth: 420, compact: false })).toBe("beside")
    expect(panelLayout({ shellWidth: wide - 1, panelWidth: 420, compact: false })).toBe("overlay")
    expect(panelLayout({ shellWidth: 1160, panelWidth: 720, compact: false })).toBe("overlay")
  })

  it("is a sheet on a compact window, and beside the chat until the shell is measured", () => {
    expect(panelLayout({ shellWidth: wide, panelWidth: 420, compact: true })).toBe("sheet")
    expect(panelLayout({ shellWidth: undefined, panelWidth: 420, compact: false })).toBe("beside")
  })
})

describe("shell banners", () => {
  it("say one line in a tone, dismissible with an icon button", () => {
    const html = renderToStaticMarkup(
      createElement(Banner, {
        t,
        tone: "warning",
        role: "alert",
        marker: "data-dshb-shell-test",
        text: "Locked",
        dismiss: { onDismiss: () => {}, afterDismiss: () => {} },
      }),
    )
    expect(html).toContain(
      'class="dshb-shell-banner" data-tone="warning" role="alert" data-dshb-shell-test=""',
    )
    expect(html).toContain('aria-label="error.dismiss"')
    expect(html).not.toContain("dshb-link")
  })
})

describe("folded menu bar", () => {
  it("is a closed menu button until pressed", () => {
    const viewer = createViewer()
    const menu = value(
      builtinShellEntries({
        viewer,
        panels: createSidePanels(viewer),
        approvals: idleApprovals,
        inquiries: idleInquiries,
        connectors: idleConnectorPanels.connectors,
      }),
    )
    const html = renderToStaticMarkup(
      createElement(ShellMenuButton, { t, menu, renderEntry: () => null }),
    )
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-dshb-shell-menu-button=""')
    expect(html).not.toContain('role="menu"')
  })
})

describe("connector preparation", () => {
  it("is one compact row: the stage, the elapsed time as meta, a busy pill and the hint as tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectorPreparing, {
        t,
        text: (text) => text.en,
        readiness: {
          state: "preparing",
          since: 0,
          stage: { kind: "running", step: "installing packages", since: 0 },
        },
        hint: { en: "It can take minutes" },
      }),
    )
    expect(html).toMatch(/^<div class="dshb-ui-row" data-kind="plain" data-density="compact"/)
    expect(html).toContain('title="It can take minutes"')
    expect(html).toContain('data-dshb-preparing-stage="running"')
    expect(html).toContain("installing packages")
    expect(html).toContain("connectors.preparing.elapsed(")
    expect(html).toContain('data-tone="busy"')
    expect(html).not.toContain("<p")
  })
})

describe("ui additions", () => {
  it("a disclosing NavRow says whether it is expanded", () => {
    const html = renderToStaticMarkup(
      createElement(NavRow, { label: "Sent", expanded: true, onOpen: () => {} }),
    )
    expect(html).toContain("data-expanded")
    expect(html).toContain('aria-expanded="true"')
    const plain = renderToStaticMarkup(createElement(NavRow, { label: "Open", onOpen: () => {} }))
    expect(plain).not.toContain("expanded")
  })

  it("an EmptyState shows one detail line under its title", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { icon: null, title: "Waiting", detail: "the VM is stopped" }),
    )
    expect(html).toContain('<div class="dshb-ui-empty-detail">the VM is stopped</div>')
  })
})
