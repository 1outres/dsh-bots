import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { createStore } from "../src/client/observable"
import {
  AddRow,
  BlockRow,
  Button,
  COMMITTED,
  commitWith,
  EmptyState,
  Group,
  LinkRow,
  NavRow,
  PageTitle,
  Row,
  SearchSelect,
  SecretRow,
  Segmented,
  Select,
  StatusPill,
  Switch,
  searchChoices,
  Tag,
  TextFieldRow,
} from "../src/client/ui"
import { createLayerStack } from "../src/client/ui/layers"
import { CLOSED_SECRET, secretEditorReducer } from "../src/client/ui/secret-editor"
import { draftReducer, initialDraft, isEditing } from "../src/client/ui/text-draft"
import { closeDrawerOnOpen } from "../src/client/wiring/drawer"
import { t } from "./support/client"

const html = (element: ReactElement) => renderToStaticMarkup(element)
const saved = async () => COMMITTED

describe("Group and rows", () => {
  it("titles a group with an h4 over a hairline frame of rows", () => {
    const markup = html(
      createElement(Group, {
        title: "Capabilities",
        tag: createElement(Tag, { children: "DEV" }),
        aside: "filter",
        children: createElement(Row, { label: "Search", meta: "3 bots", trailing: "x" }),
      }),
    )
    expect(markup).toMatch(
      /<section class="dshb-ui-group" aria-labelledby="([^"]+)"><div class="dshb-ui-group-head"><h4 class="dshb-ui-group-title" id="\1"><span class="dshb-ui-heading-text">Capabilities<\/span><span class="dshb-ui-tag">DEV<\/span><\/h4>filter<\/div>/,
    )
    expect(markup).toContain('<span class="dshb-ui-row-meta">3 bots</span>')
    expect(markup).toContain('<div class="dshb-ui-row-trailing">x</div>')
    expect(html(createElement(Group, { children: "rows" }))).not.toContain("<h4")
  })

  it("makes an open row one button with a chevron, its controls outside the button", () => {
    const markup = html(
      createElement(NavRow, {
        label: "Desktop",
        onOpen() {},
        trailing: createElement(Switch, { checked: true, onChange() {}, label: "Desktop" }),
      }),
    )
    expect(markup).toMatch(/data-kind="open"[^>]*><button type="button" class="dshb-ui-row-open">/)
    expect(markup).toMatch(
      /<\/button><div class="dshb-ui-row-trailing"><button type="button" role="switch"/,
    )
    expect(markup).toContain("dshb-ui-row-chevron")
  })

  it("keeps a description out of sight: the tooltip and screen-reader text", () => {
    const markup = html(
      createElement(Row, { label: "read_file", description: "Reads a file", density: "compact" }),
    )
    expect(markup).toContain('title="Reads a file"')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('<span class="dshb-sr">Reads a file</span>')
  })

  it("draws block, link and add rows and a page title", () => {
    expect(html(createElement(BlockRow, { label: "Owners", children: "list" }))).toContain(
      '<div class="dshb-ui-row-block">list</div>',
    )
    expect(html(createElement(LinkRow, { label: "Setup guide", href: "https://x.test" }))).toMatch(
      /<a[^>]*href="https:\/\/x.test" target="_blank" rel="noopener noreferrer"/,
    )
    expect(html(createElement(AddRow, { label: "Add account", onAdd() {} }))).toContain(
      "dshb-ui-add-row",
    )
    expect(html(createElement(PageTitle, { trailing: "on", children: "Desktop" }))).toContain(
      '<h3 class="dshb-ui-page-heading"><span class="dshb-ui-heading-text">Desktop</span></h3>',
    )
  })
})

describe("controls", () => {
  it("names a switch and reports its state", () => {
    const markup = html(
      createElement(Switch, { checked: false, onChange() {}, label: "Search", disabled: true }),
    )
    expect(markup).toBe(
      '<button type="button" role="switch" class="dshb-ui-switch" aria-checked="false" aria-label="Search" disabled=""><span class="dshb-ui-switch-thumb"></span></button>',
    )
  })

  it("draws a segmented choice as native radios, the picked one marked", () => {
    const markup = html(
      createElement(Segmented<"allow" | "ask">, {
        value: "ask",
        choices: [
          { value: "allow", label: "Allow" },
          { value: "ask", label: "Ask" },
        ],
        onChange() {},
        label: "Permission",
      }),
    )
    expect(markup).toMatch(/<fieldset class="dshb-ui-segmented" aria-label="Permission">/)
    expect(markup.match(/type="radio"/g)).toHaveLength(2)
    expect(markup).toMatch(/data-checked=""><input type="radio"[^>]*checked="" value="ask"/)
  })

  it("names a select and a searchable select, the latter closed until opened", () => {
    const choices = [
      { value: "UTC", label: "UTC" },
      { value: "Asia/Tokyo", label: "Asia/Tokyo" },
    ] as const
    expect(
      html(
        createElement(Select<string>, { value: "UTC", choices, onChange() {}, label: "Time zone" }),
      ),
    ).toMatch(/<select class="dshb-ui-select-input" aria-label="Time zone">/)
    const search = html(
      createElement(SearchSelect<string>, {
        t,
        value: "Asia/Tokyo",
        choices,
        onChange() {},
        label: "Time zone",
      }),
    )
    expect(search).toMatch(
      /role="combobox" aria-label="Time zone" aria-haspopup="listbox" aria-expanded="false"/,
    )
    expect(search).toContain("Asia/Tokyo")
    expect(search).not.toContain('role="listbox"')
  })

  it("filters choices by every word, matching underscores as spaces", () => {
    const choices = [
      { value: "America/New_York", label: "America/New_York" },
      { value: "Asia/Tokyo", label: "Asia/Tokyo" },
    ]
    expect(searchChoices(choices, "new york").map((choice) => choice.value)).toEqual([
      "America/New_York",
    ])
    expect(searchChoices(choices, "  ")).toBe(choices)
    expect(searchChoices(choices, "asia paris")).toEqual([])
  })

  it("draws buttons by variant and tone, an icon button named by its label", () => {
    expect(
      html(createElement(Button, { variant: "primary", tone: "danger", children: "Delete" })),
    ).toBe(
      '<button type="button" class="dshb-ui-button" data-variant="primary" data-tone="danger">Delete</button>',
    )
    expect(
      html(createElement(Button, { variant: "icon", label: "Close", children: "×" })),
    ).toContain('aria-label="Close" title="Close"')
  })

  it("draws a pill, an empty state and a text field row", () => {
    expect(html(createElement(StatusPill, { tone: "busy", label: "Connecting" }))).toBe(
      '<span class="dshb-ui-pill" data-tone="busy"><span class="dshb-ui-pill-dot" aria-hidden="true"></span>Connecting</span>',
    )
    expect(html(createElement(EmptyState, { icon: "i", title: "No settings yet" }))).toContain(
      '<p class="dshb-ui-empty-title">No settings yet</p>',
    )
    const field = html(
      createElement(TextFieldRow, { label: "Client ID", value: "abc", commit: saved }),
    )
    expect(field).toMatch(
      /<input class="dshb-ui-field-input" type="text" aria-label="Client ID" value="abc"/,
    )
  })

  it("shows a secret's state and the way to set, replace or remove it", () => {
    const unset = html(
      createElement(SecretRow, { t, label: "API key", saved: false, commit: saved }),
    )
    expect(unset).toContain('data-dshb-secret="unset"')
    expect(unset).toContain("ui.secret.state.unset")
    expect(unset).toContain("ui.secret.set")
    expect(unset).not.toContain("ui.secret.remove")
    const set = html(
      createElement(SecretRow, { t, label: "API key", saved: true, commit: saved, remove: saved }),
    )
    expect(set).toContain("ui.secret.replace")
    expect(set).toMatch(/data-variant="row" data-tone="danger"[^>]*>ui.secret.remove/)
    expect(
      html(
        createElement(SecretRow, {
          t,
          label: "API key",
          saved: true,
          commit: saved,
          status: "Valid",
        }),
      ),
    ).not.toContain("dshb-ui-pill")
  })
})

describe("text draft", () => {
  it("edits over the saved value, and follows it while not edited", () => {
    let state = initialDraft("a")
    expect(isEditing(state)).toBe(false)
    state = draftReducer(state, { kind: "change", text: "ab" })
    expect(isEditing(state)).toBe(true)
    state = draftReducer(state, { kind: "value", value: "z" })
    expect(state).toMatchObject({ text: "ab", base: "z" })
    state = draftReducer(state, { kind: "reset" })
    expect(state).toEqual(initialDraft("z"))
    state = draftReducer(state, { kind: "value", value: "y" })
    expect(state.text).toBe("y")
  })

  it("keeps the text and the error of an invalid or failed save; a saved text waits for the stored value", () => {
    let state = draftReducer(initialDraft("a"), { kind: "change", text: "" })
    state = draftReducer(state, { kind: "invalid", error: "Required" })
    expect(state).toMatchObject({ text: "", error: "Required" })
    state = draftReducer(state, { kind: "change", text: "b " })
    expect(state.error).toBeNull()
    state = draftReducer(state, { kind: "saving" })
    state = draftReducer(state, { kind: "failed", error: "Offline" })
    expect(state).toMatchObject({ text: "b ", error: "Offline", busy: false })
    state = draftReducer(state, { kind: "saving" })
    state = draftReducer(state, { kind: "saved" })
    expect(isEditing(state)).toBe(false)
    state = draftReducer(state, { kind: "value", value: "b" })
    expect(state).toEqual(initialDraft("b"))
  })
})

describe("secret editor", () => {
  it("opens empty, keeps a failure open, and closes on cancel", () => {
    let state = secretEditorReducer(CLOSED_SECRET, { kind: "open" })
    expect(state).toEqual({ open: true, text: "", error: null, busy: false })
    state = secretEditorReducer(state, { kind: "change", text: "k" })
    state = secretEditorReducer(state, { kind: "saving" })
    state = secretEditorReducer(state, { kind: "failed", error: "Rejected" })
    expect(state).toEqual({ open: true, text: "k", error: "Rejected", busy: false })
    expect(secretEditorReducer(state, { kind: "close" })).toBe(CLOSED_SECRET)
  })

  it("turns a rejected save into a failed result", async () => {
    await expect(commitWith(async () => {}, String)).resolves.toBe(COMMITTED)
    await expect(
      commitWith(
        async () => {
          throw new Error("nope")
        },
        (cause) => (cause instanceof Error ? cause.message : "?"),
      ),
    ).resolves.toEqual({ ok: false, message: "nope" })
  })
})

describe("layer stack", () => {
  const layer = (trap: boolean) => ({ element: () => null, trap, escape: vi.fn() })

  it("gives Escape to the top layer and focus to the top trapping one", () => {
    const stack = createLayerStack()
    const frame = layer(true)
    const popover = layer(false)
    const offFrame = stack.push(frame)
    const offPopover = stack.push(popover)
    expect(stack.top()).toBe(popover)
    expect(stack.topTrap()).toBe(frame)
    offPopover()
    expect(stack.top()).toBe(frame)
    offFrame()
    offFrame()
    expect(stack.size()).toBe(0)
  })
})

describe("closeDrawerOnOpen", () => {
  it("closes an open drawer when a modal opens, and only then", () => {
    const opened = createStore(false)
    const drawer = { open: true, isOpen: () => drawer.open, close: vi.fn() }
    const off = closeDrawerOnOpen(drawer, opened)
    opened.set(true)
    expect(drawer.close).toHaveBeenCalledTimes(1)
    opened.set(false)
    drawer.open = false
    opened.set(true)
    expect(drawer.close).toHaveBeenCalledTimes(1)
    off()
  })
})
