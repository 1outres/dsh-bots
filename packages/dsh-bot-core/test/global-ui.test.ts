import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AvatarPicker } from "../src/client/AvatarPicker"
import { AVATAR_COLORS, DEFAULT_AVATAR_CHOICE } from "../src/client/avatar-data"
import { BotNoticeToast } from "../src/client/BotNoticeToast"
import { BotDialog } from "../src/client/CreateBotDialog"
import { createNoticeStore } from "../src/client/notices"
import { PendingBotRow } from "../src/client/PendingBotRow"
import { pendingKey } from "../src/client/tree"
import type { WebLookupFeed, WebLookupState } from "../src/client/web/feed"
import { createWebLookupModel } from "../src/client/web/model"
import { WebLookupSection } from "../src/client/web/WebLookupSection"
import type { BotCreationOffer } from "../src/shared/bots"
import type { BotModelCatalog } from "../src/shared/models"
import type { BotWebView } from "../src/shared/web"
import { creating, t, value } from "./support/client"

const view = (set: boolean): BotWebView => ({
  backend: {
    id: "exa",
    name: { en: "Exa" },
    description: { en: "Searches with Exa." },
    capabilities: ["search", "fetch"],
    secrets: [{ key: "apiKey", label: { en: "Exa API key" }, set }],
  },
  settings: { backend: "exa", search: true, fetch: true },
  status: set
    ? { search: { state: "ready", backend: "exa" }, fetch: { state: "ready", backend: "exa" } }
    : {
        search: { state: "missing-secrets", backend: "exa", keys: ["apiKey"] },
        fetch: { state: "missing-secrets", backend: "exa", keys: ["apiKey"] },
      },
})

function feedOf(state: WebLookupState) {
  const store = value(state)
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    set: store.set,
    setEnabled: vi.fn(async () => view(true)),
    setSecret: vi.fn(async () => view(true)),
    test: vi.fn(async () => ({ ok: true as const })),
  } satisfies WebLookupFeed & { set(next: WebLookupState): void }
}

function renderWeb(state: WebLookupState): string {
  return renderToStaticMarkup(
    createElement(WebLookupSection, {
      t,
      confirm: async () => true,
      feed: feedOf(state),
      text: (text) => text.en,
    }),
  )
}

describe("Web lookup section", () => {
  it("shows the key as a secret row and the capabilities as disabled switches while it is missing", () => {
    const html = renderWeb({ status: "ready", view: view(false) })
    expect(html).toContain('data-dshb-web-backend="exa"')
    expect(html).toContain('data-dshb-web-secret="unset"')
    expect(html).toContain("ui.secret.state.unset")
    expect(html).not.toContain("data-dshb-web-test=")
    expect(html.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(2)
    expect(html).not.toContain("Searches with Exa.")
    expect(html).not.toContain("dshb-hint")
  })

  it("offers the test and live switches once the key is stored", () => {
    const html = renderWeb({ status: "ready", view: view(true) })
    expect(html).toContain('data-dshb-web-secret="set"')
    expect(html).toMatch(/data-variant="row"[^>]*data-dshb-web-test="">web.test.run/)
    expect(html).not.toMatch(/role="switch"[^>]*disabled/)
  })

  it("shows nothing while loading and the failure when the settings cannot be read", () => {
    expect(renderWeb({ status: "loading" })).not.toContain("dshb-ui-group")
    const failed = renderWeb({ status: "failed", failure: { kind: "connection", message: "gone" } })
    expect(failed).toContain('role="alert"')
    expect(failed).toContain("web.unavailable(gone)")
  })

  it("names an uninstalled backend as an error", () => {
    const html = renderWeb({ status: "ready", view: { ...view(false), backend: null } })
    expect(html).toContain("web.backend.missing(exa)")
    expect(html).not.toContain("data-dshb-web-backend")
  })
})

describe("Web lookup model", () => {
  it("saves a trimmed key and clears a shown test result", async () => {
    const feed = feedOf({ status: "ready", view: view(true) })
    const model = createWebLookupModel(feed)
    await model.test()
    expect(model.getSnapshot().test).toEqual({ state: "done", result: { ok: true } })
    await model.saveSecret("apiKey", "  k1  ")
    expect(feed.setSecret).toHaveBeenCalledWith("apiKey", { op: "set", value: "k1" })
    expect(model.getSnapshot().test).toEqual({ state: "idle" })
  })

  it("takes a settled test result off and keeps a running one", async () => {
    const feed = feedOf({ status: "ready", view: view(true) })
    feed.test.mockRejectedValueOnce(new Error("offline"))
    const model = createWebLookupModel(feed)
    await model.test()
    expect(model.getSnapshot().test).toEqual({ state: "failed", message: "offline" })
    model.settleTest()
    expect(model.getSnapshot().test).toEqual({ state: "idle" })
  })

  it("records a refused switch and lets the next one through", async () => {
    const feed = feedOf({ status: "ready", view: view(true) })
    feed.setEnabled.mockRejectedValueOnce(new Error("refused"))
    const model = createWebLookupModel(feed)
    await model.setEnabled("fetch", false)
    expect(model.getSnapshot()).toMatchObject({ saving: null, error: "refused" })
    await model.setEnabled("fetch", false)
    expect(model.getSnapshot().error).toBeNull()
    expect(feed.setEnabled).toHaveBeenCalledTimes(2)
  })

  it("rejects a refused key so its row keeps the editor open", async () => {
    const feed = feedOf({ status: "ready", view: view(false) })
    feed.setSecret.mockRejectedValueOnce(new Error("too long"))
    await expect(createWebLookupModel(feed).saveSecret("apiKey", "x")).rejects.toThrow("too long")
  })
})

describe("New bot dialog", () => {
  it("is a title, the avatar and name, the picker and Cancel / Create, without hints", () => {
    const html = renderToStaticMarkup(
      createElement(BotDialog, {
        t,
        creationOptions: () => new Promise<BotCreationOffer>(() => {}),
        modelCatalog: () => new Promise<BotModelCatalog>(() => {}),
        onSubmit: async () => {},
        onClose() {},
      }),
    )
    expect(html).toContain("section.new")
    expect(html).toContain("data-dshb-create-name")
    expect(html).toContain('placeholder="form.namePlaceholder"')
    expect(html).toMatch(/data-dshb-create-model[\s\S]*models.profileDefault/)
    expect(html).toMatch(/data-variant="primary"[^>]*disabled=""[^>]*data-dshb-create-submit/)
    expect(html).not.toContain("form.createHint")
    expect(html).not.toContain("form.nameRequired")
    expect(html).not.toContain("form.counter")
    expect(html).not.toContain("dshb-hint")
  })
})

describe("Avatar picker", () => {
  it("puts characters, the image picker and colors in one grid of cells", () => {
    const html = renderToStaticMarkup(
      createElement(AvatarPicker, {
        t,
        name: "Ada",
        value: DEFAULT_AVATAR_CHOICE,
        onChange() {},
      }),
    )
    expect(html.match(/class="dshb-avatar-choice" role="radio"/g)).toHaveLength(9 + 8)
    expect(html).toMatch(/class="dshb-avatar-choice" aria-pressed="false" aria-label="form.upload"/)
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2)
    expect(html).not.toContain("<legend")
    expect(html).not.toContain("dshb-upload")
  })

  it("draws every character in the chosen color, then the initial, and marks the choice", () => {
    const html = renderToStaticMarkup(
      createElement(AvatarPicker, {
        t,
        name: "Ada",
        value: { figure: "kitty", color: AVATAR_COLORS[5], image: undefined },
        onChange() {},
      }),
    )
    const figures = [...html.matchAll(/role="radio" aria-label="(avatar\.[^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(figures.slice(0, 9)).toEqual([
      "avatar.character.capsule",
      "avatar.character.antenna",
      "avatar.character.scanner",
      "avatar.character.ears",
      "avatar.character.kitty",
      "avatar.character.twin",
      "avatar.character.monitor",
      "avatar.character.sleepy",
      "avatar.initial(A)",
    ])
    expect(html.match(/data-dshb-character="/g)).toHaveLength(8)
    expect(
      html.match(new RegExp(`<rect width="64" height="64" fill="${AVATAR_COLORS[5]}"`, "g")),
    ).toHaveLength(8)
    expect(html).toMatch(/aria-label="avatar\.character\.kitty" title="[^"]*" aria-checked="true"/)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2)
    const clipIds = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(clipIds).size).toBe(8)
  })
})

describe("Notice toast", () => {
  const render = (notice: Parameters<ReturnType<typeof createNoticeStore>["show"]>[0]) => {
    const notices = createNoticeStore()
    notices.show(notice)
    return renderToStaticMarkup(
      createElement(BotNoticeToast, {
        t,
        notices,
        actions: { undoArchive() {}, showArchived() {} },
      }),
    )
  }

  it("is DSH's toast: an icon by tone, the text, inline actions and no close button", () => {
    const created = render({ kind: "created", name: "Ada" })
    expect(created).toContain('data-tone="success"')
    expect(created).toContain("dshb-toast-icon")
    expect(created).not.toContain("form.close")
    const archived = render({ kind: "session-archived", botId: "a", sessionId: "s" })
    expect(archived).not.toContain("dshb-toast-icon")
    expect(archived.match(/class="dshb-toast-action"/g)).toHaveLength(2)
  })
})

describe("Pending bot row", () => {
  it("offers Retry, Discard and the details as row buttons", () => {
    const failed = {
      ...creating("a"),
      failure: { message: "boom", at: 0 },
    } as Parameters<typeof PendingBotRow>[0]["node"]["pending"]
    const html = renderToStaticMarkup(
      createElement(PendingBotRow, {
        t,
        node: { kind: "pending", pending: failed, key: pendingKey("a"), selected: false },
        tabKey: undefined,
        index: 0,
        count: 1,
        pending: { retryCreate() {}, discardCreate() {}, retryRemove() {}, dismissRemove() {} },
        openProgress() {},
        status: value({ a: { error: "stuck" } }),
        clearError() {},
      }),
    )
    expect(html).toMatch(/data-variant="row"[^>]*data-dshb-pending-action="retry"/)
    expect(html).toMatch(
      /data-variant="row" data-tone="danger"[^>]*data-dshb-pending-action="discard"/,
    )
    expect(html).toMatch(
      /data-variant="icon"[^>]*aria-expanded="false"[^>]*data-dshb-pending-action="details"/,
    )
    expect(html).toMatch(/dshb-row-error[\s\S]*aria-label="error.dismiss"/)
    expect(html).not.toContain("dshb-link")
    expect(html).not.toContain("dshb-pending-button")
  })
})
