import { describe, expect, it } from "vitest"
import { isBotPresetRow, markMenu, unmarkMenu } from "../src/client/hide-picker-workspaces"

/** Just enough of an Element for the attribute selectors the picker uses. */
class FakeElement {
  readonly attrs = new Map<string, string>()
  readonly children: FakeElement[] = []
  parentElement: FakeElement | null = null
  constructor(
    readonly tagName: string,
    attrs: Record<string, string> = {},
    private readonly text = "",
  ) {
    for (const [name, value] of Object.entries(attrs)) this.attrs.set(name, value)
  }
  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
    return this
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("")
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled")
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  toggleAttribute(name: string, force: boolean): boolean {
    if (force) this.attrs.set(name, "")
    else this.attrs.delete(name)
    return force
  }
  querySelectorAll(selector: string): FakeElement[] {
    const match = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector)
    if (match === null) throw new Error(`unsupported selector ${selector}`)
    const [, name = "", value] = match
    const out: FakeElement[] = []
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.hasAttribute(name) && (value === undefined || child.getAttribute(name) === value))
          out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

const folder = () => new FakeElement("svg", { "data-icon": "dsw-icon-folder-close-regular" })
const PRESET = 'Bot: AlphaAgent preset of bot "Alpha", composed from template "Default" (default).'
const row = (label: string, attrs: Record<string, string> = {}, workspace = false) => {
  const button = new FakeElement("button", { role: "menuitem", ...attrs }).append(
    ...(workspace ? [folder()] : []),
    new FakeElement("span", {}, label),
  )
  return { wrapper: new FakeElement("div").append(button), button }
}
/** What the host Menu's keyboard walk visits: `button:not(:disabled)`. */
const walk = (menu: FakeElement) =>
  menu.querySelectorAll('[role="menuitem"]').filter((button) => !button.disabled)

describe("picker menu marking", () => {
  it("hides bot preset rows and takes them out of the keyboard walk", () => {
    const alpha = row(PRESET)
    const standard = row("StandardGeneral-purpose coding agent")
    const menu = new FakeElement("div", { role: "menu" }).append(alpha.wrapper, standard.wrapper)
    markMenu(menu as unknown as Element)
    expect(alpha.wrapper.hasAttribute("data-dshb-bot-workspace")).toBe(true)
    expect(alpha.button.disabled).toBe(true)
    expect(standard.button.disabled).toBe(false)
    expect(walk(menu)).toEqual([standard.button])

    unmarkMenu(menu as unknown as Element)
    expect(alpha.wrapper.hasAttribute("data-dshb-bot-workspace")).toBe(false)
    expect(alpha.button.disabled).toBe(false)
    expect(walk(menu)).toEqual([alpha.button, standard.button])
  })

  it("leaves workspace rows alone: bots own no Workspace", () => {
    const alice = row("Alice", {}, true)
    const menu = new FakeElement("div", { role: "menu" }).append(alice.wrapper)
    markMenu(menu as unknown as Element)
    expect(alice.wrapper.hasAttribute("data-dshb-bot-workspace")).toBe(false)
    expect(alice.button.disabled).toBe(false)
  })

  it("keeps the selected row enabled and a host-disabled row disabled", () => {
    const selected = row(PRESET, { "aria-checked": "true" })
    const host = row(PRESET, { disabled: "" })
    const menu = new FakeElement("div", { role: "menu" }).append(selected.wrapper, host.wrapper)
    markMenu(menu as unknown as Element)
    expect(selected.button.disabled).toBe(false)
    expect(host.button.disabled).toBe(true)
    unmarkMenu(menu as unknown as Element)
    expect(host.button.disabled).toBe(true)
  })
})

describe("isBotPresetRow", () => {
  const row = (label: string, selected = false) => ({ folder: false, selected, label })
  it("matches a bot preset by its description, but not the selected one", () => {
    const label =
      'Bot: AlphaAgent preset of bot "Alpha", composed from template "Default" (default).'
    expect(isBotPresetRow(row(label))).toBe(true)
    expect(isBotPresetRow(row(label, true))).toBe(false)
    expect(isBotPresetRow(row("StandardGeneral-purpose coding agent"))).toBe(false)
    expect(isBotPresetRow({ folder: true, selected: false, label })).toBe(false)
  })
})
