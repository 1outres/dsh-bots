import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { confirmsDeletion, createBotDeletion } from "../src/client/bot-deletion"
import { DeleteBotDialog } from "../src/client/DeleteBotDialog"
import { ConnectionsSettings } from "../src/client/global-settings/ConnectionsSettings"
import { createSerialSaves } from "../src/client/serial-saves"
import type { BotsState } from "../src/client/session-classification"
import {
  accountsDetail,
  connectorDetail,
  connectorsPageOf,
} from "../src/client/settings/connectors-pages"
import { timeZoneChoices } from "../src/client/time-zones"
import { ButtonRow, RowMenu, TextArea } from "../src/client/ui"
import type { TextDraft } from "../src/client/ui/text-draft"
import { providerProblem } from "../src/host/connections/providers"
import type { ConnectionProviderView } from "../src/shared/connections"
import { bot, t, value } from "./support/client"
import { idleConnections } from "./support/connectors-client"

describe("serial saves", () => {
  it("applies each edit over what the save before it stored, then reads the stored value again", async () => {
    let stored = { a: 0, b: 0 }
    const seen: { a: number; b: number }[] = []
    const saves = createSerialSaves<typeof stored, Partial<typeof stored>>({
      current: () => stored,
      apply: async (base, edit) => {
        seen.push(base)
        await new Promise((resolve) => setTimeout(resolve, 1))
        return { ...base, ...edit }
      },
    })
    await Promise.all([saves.save({ a: 1 }), saves.save({ b: 2 })])
    expect(seen).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 0 },
    ])
    stored = { a: 5, b: 5 }
    await saves.save({ a: 6 })
    expect(seen.at(-1)).toEqual({ a: 5, b: 5 })
  })

  it("rejects a failed save and goes on with the next over the stored value", async () => {
    const saves = createSerialSaves<number, number>({
      current: () => 10,
      apply: async (base, edit) => {
        if (edit < 0) throw new Error("refused")
        return base + edit
      },
    })
    const failed = saves.save(-1)
    const next = saves.save(1)
    await expect(failed).rejects.toThrow("refused")
    await expect(next).resolves.toBeUndefined()
  })
})

describe("bot deletion", () => {
  it("asks for one bot, deletes it once confirmed and closes what shows it", async () => {
    const removeBot = vi.fn(async () => {})
    const deleted = vi.fn()
    const deletion = createBotDeletion({ removeBot, deleted })
    await deletion.confirm("x")
    expect(removeBot).not.toHaveBeenCalled()
    deletion.ask("x")
    expect(deletion.asking.getSnapshot()).toBe("x")
    await deletion.confirm("x")
    expect(removeBot).toHaveBeenCalledWith("x")
    expect(deleted).toHaveBeenCalledWith("x")
    expect(deletion.asking.getSnapshot()).toBeNull()
    deletion.ask("y")
    deletion.cancel()
    expect(deletion.asking.getSnapshot()).toBeNull()
  })

  it("takes the bot's name typed in full", () => {
    expect(confirmsDeletion("Bot x", "Bot x")).toBe(true)
    expect(confirmsDeletion(" Bot x ", "Bot x")).toBe(true)
    expect(confirmsDeletion("bot x", "Bot x")).toBe(false)
    expect(confirmsDeletion("", "Bot x")).toBe(false)
  })

  it("draws the confirmation for the asked bot only, Delete disabled until its name is typed", () => {
    const bots = value<BotsState>({
      status: "ready",
      snapshot: { bots: [bot("x", "m")], pending: [], preparingSessionIds: [] },
    })
    const deletion = createBotDeletion({ removeBot: async () => {}, deleted: () => {} })
    const render = () => renderToStaticMarkup(createElement(DeleteBotDialog, { t, bots, deletion }))
    expect(render()).toBe("")
    deletion.ask("x")
    const html = render()
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('data-dshb-delete-bot="x"')
    expect(html).toContain("settings.delete.title(Bot x)")
    expect(html).toContain('placeholder="Bot x"')
    expect(html).toMatch(/data-tone="danger" disabled=""[^>]*data-dshb-delete-bot-accept/)
    deletion.ask("gone")
    expect(render()).toBe("")
  })
})

describe("connectors pages", () => {
  it("names a connector's and a provider's page, and reads them back", () => {
    expect(connectorsPageOf(null)).toEqual({ kind: "list" })
    expect(connectorsPageOf(connectorDetail("gmail"))).toEqual({
      kind: "connector",
      connectorId: "gmail",
    })
    expect(connectorsPageOf(accountsDetail("google"))).toEqual({
      kind: "accounts",
      provider: "google",
    })
    expect(connectorsPageOf("elsewhere")).toEqual({ kind: "list" })
  })
})

describe("time zones", () => {
  it("lists UTC first and the saved zone always", () => {
    const zones = timeZoneChoices("Asia/Tokyo")
    expect(zones[0]).toEqual({ value: "UTC", label: "UTC" })
    expect(zones.filter((zone) => zone.value === "UTC")).toHaveLength(1)
    expect(zones.find((zone) => zone.value === "America/New_York")?.label).toBe("America/New York")
    expect(timeZoneChoices("Etc/Unknown")[0]?.value).toBe("Etc/Unknown")
  })
})

describe("dsh-bots Accounts", () => {
  const provider: ConnectionProviderView = {
    id: "google",
    name: "Google",
    services: [],
    client: { clientId: "id", secretSet: true, configured: true },
    callbackPath: "/bot-core/oauth/callback",
    development: false,
    guide: "https://example.com/guide",
  }
  const render = (client: ConnectionProviderView["client"]) =>
    renderToStaticMarkup(
      createElement(ConnectionsSettings, {
        t,
        page: { detail: null, open() {}, back() {} },
        close: () => {},
        confirm: async () => false,
        connections: {
          ...idleConnections(),
          getSnapshot: () => ({
            status: "ready" as const,
            snapshot: { providers: [{ ...provider, client }], connections: [], attempts: [] },
          }),
        },
      }),
    )

  it("sets the OAuth client up in rows saved on their own, then lists the accounts", () => {
    vi.stubGlobal("window", { location: { origin: "http://dsh" } })
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } })
    const html = render(provider.client)
    expect(html).toContain('data-dshb-oauth="google"')
    expect(html).toContain("http://dsh/bot-core/oauth/callback")
    expect(html).toContain("data-dshb-oauth-copy")
    expect(html).toMatch(/<input[^>]*data-dshb-oauth-client=""[^>]*value="id"/)
    expect(html).toContain('data-dshb-secret="set"')
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).toContain('data-dshb-connections="google"')
    expect(html).not.toContain("data-dshb-connections-add")
    expect(html).not.toContain('type="submit"')
    expect(render({ secretSet: false, configured: false })).not.toContain("data-dshb-connections=")
    vi.stubGlobal("navigator", {})
    expect(render(provider.client)).not.toContain("data-dshb-oauth-copy")
    vi.unstubAllGlobals()
  })
})

describe("providers", () => {
  it("take a setup guide only at an https address", () => {
    const base = {
      id: "p",
      name: "P",
      oauth: {
        authorizationEndpoint: "https://p.example/auth",
        tokenEndpoint: "https://p.example/token",
        identityScopes: ["openid"],
      },
      identify: async () => ({ subject: "s" }),
    }
    expect(providerProblem({ ...base, guide: "https://p.example/guide" })).toBeUndefined()
    expect(providerProblem({ ...base, guide: "http://p.example/guide" })).toContain("guide")
  })
})

describe("added components", () => {
  const draft = (text: string, error: string | null = null): TextDraft => ({
    text,
    error,
    editing: false,
    busy: false,
    change() {},
    commit() {},
    reset() {},
  })

  it("a row menu is one named button until opened", () => {
    const html = renderToStaticMarkup(
      createElement(RowMenu, { label: "More", items: [{ id: "a", label: "A", run() {} }] }),
    )
    expect(html).toMatch(/aria-label="More"[^>]*aria-haspopup="menu" aria-expanded="false"/)
    expect(html).not.toContain('role="menu"')
  })

  it("a text area shows its draft's error, or a flag of its row", () => {
    expect(
      renderToStaticMarkup(createElement(TextArea, { draft: draft("1", "bad"), label: "L" })),
    ).toContain('aria-invalid="true"')
    const warned = renderToStaticMarkup(
      createElement(TextArea, { draft: draft(""), label: "L", flag: "warning" }),
    )
    expect(warned).toContain('data-flag="warning"')
    expect(warned).not.toContain("aria-invalid")
  })

  it("a button row is one action, red for a destructive one", () => {
    const html = renderToStaticMarkup(
      createElement(ButtonRow, { label: "Delete", tone: "danger", onClick() {} }),
    )
    expect(html).toMatch(
      /<button type="button" class="dshb-ui-row dshb-ui-button-row" data-kind="action"[^>]*data-tone="danger"/,
    )
  })
})
