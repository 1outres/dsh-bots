import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  DshSettingsPage,
  leaveForGlobalSettings,
} from "../src/client/global-settings/DshSettingsPage"
import type { GlobalSettingsTarget } from "../src/client/global-settings/flow"
import { createGlobalSettingsFlow } from "../src/client/global-settings/flow"
import { GlobalSettingsScreen } from "../src/client/global-settings/GlobalSettingsScreen"
import {
  createGlobalSettingsSections,
  type GlobalSettingsSection,
  type GlobalSettingsSectionProps,
} from "../src/client/global-settings/sections"
import { en, ja } from "../src/client/i18n"
import { createStore } from "../src/client/observable"
import type { Translate } from "../src/client/types"
import type { SettingsScreenId } from "../src/client/wiring/screens"
import { t, value } from "./support/client"

const section = (id: string, order: number): GlobalSettingsSection => ({
  id,
  order,
  label: () => id,
  icon: () => null,
  component: ({ t: translate }) => createElement("p", null, `${id} body ${translate("x")}`),
})

function setup() {
  const sections = createGlobalSettingsSections()
  const store = createStore<GlobalSettingsTarget | null>(null)
  const flow = createGlobalSettingsFlow(store, sections)
  const render = (translate: Translate = t) =>
    renderToStaticMarkup(
      createElement(GlobalSettingsScreen, { t: translate, flow, sections, stack: value(stack) }),
    )
  let stack: readonly SettingsScreenId[] = ["global"]
  const cover = (next: readonly SettingsScreenId[]) => {
    stack = next
  }
  return { sections, store, flow, render, cover }
}

const dictionary =
  (messages: Readonly<Record<string, string>>): Translate =>
  (key) => {
    const message = messages[key]
    if (message === undefined) throw new Error(`missing message ${key}`)
    return message
  }

describe("global settings sections", () => {
  it("are their own registry, refusing a duplicate under their own name", () => {
    const { sections } = setup()
    sections.register(section("web", 100))
    sections.register(section("about", 10))
    expect(sections.getSnapshot().map((item) => item.id)).toEqual(["about", "web"])
    expect(() => sections.register(section("web", 1))).toThrow(
      'bot-core: global settings section "web" is already registered',
    )
  })

  it("hand their component nothing of a bot", () => {
    const props: GlobalSettingsSectionProps = {
      t,
      page: { detail: null, open() {}, back() {} },
      close() {},
      confirm: async () => true,
    }
    // @ts-expect-error a global section receives no bot
    expect(props.bot).toBeUndefined()
  })
})

describe("global settings flow", () => {
  it("opens with no section while none is registered, and refuses an unknown one", () => {
    const { flow } = setup()
    flow.open()
    expect(flow.target.getSnapshot()).toEqual({ section: null, detail: null, nav: true })
    expect(() => flow.open("web")).toThrow('global settings section "web" is not registered')
  })

  it("shows the first section to arrive, and the first remaining one when the open one goes", () => {
    const { flow, sections } = setup()
    flow.open()
    const offWeb = sections.register(section("web", 100))
    expect(flow.target.getSnapshot()).toEqual({ section: "web", detail: null, nav: true })
    sections.register(section("about", 200))
    flow.select("web")
    flow.openDetail("key")
    flow.edits.hold()
    offWeb()
    expect(flow.target.getSnapshot()).toEqual({ section: "about", detail: null, nav: false })
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
    flow.close()
    sections.register(section("web", 100))
    expect(flow.target.getSnapshot()).toBeNull()
  })

  it("asks before discarding typed text, like a bot's settings", () => {
    const { flow, sections } = setup()
    sections.register(section("web", 100))
    sections.register(section("about", 200))
    flow.open("web")
    flow.edits.hold()
    flow.select("about")
    expect(flow.guard.getSnapshot().leaving).toBe("move")
    flow.keepEditing()
    flow.close()
    expect(flow.guard.getSnapshot().leaving).toBe("close")
    flow.discard()
    expect(flow.target.getSnapshot()).toBeNull()
  })
})

describe("GlobalSettingsScreen", () => {
  it("draws nothing while closed", () => {
    expect(setup().render()).toBe("")
  })

  it("says there are no settings yet while no section is registered, in English and Japanese", () => {
    const { flow, render } = setup()
    flow.open()
    const html = render()
    expect(html).toMatch(/role="dialog" aria-modal="true"/)
    expect(html).toContain("data-dshb-global-settings")
    expect(html).toContain("data-dshb-settings-empty")
    expect(html).toContain("global.empty.title")
    expect(html).not.toContain('role="tablist"')
    expect(html).toContain('aria-label="settings.close"')
    const english = render(dictionary(en))
    expect(english).toContain("No settings yet")
    expect(english).toContain(">dsh-bots<")
    expect(render(dictionary(ja))).toContain("まだ設定項目はありません")
  })

  it("draws registered sections in the same frame as a bot's settings", () => {
    const { flow, sections, render } = setup()
    sections.register(section("web", 100))
    sections.register({
      ...section("about", 200),
      badge: () => value({ tone: "warning", label: () => "Key missing" }),
    })
    flow.open("web")
    const html = render()
    expect(html).toContain('role="tablist" aria-orientation="vertical"')
    expect([...html.matchAll(/data-dshb-settings-tab="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "web",
      "about",
    ])
    expect(html).toMatch(/aria-selected="true"[^>]*data-dshb-settings-tab="web"/)
    expect(html).toContain('data-dshb-settings-section="web"')
    expect(html).toContain("web body x")
    expect(html).toMatch(/data-tone="warning" title="Key missing"/)
    expect(html).not.toContain("data-dshb-settings-empty")
    flow.edits.hold()
    flow.close()
    expect(render()).toContain("settings.discard.close")
  })

  it("shows the success of a section nowhere in the nav, only what calls for the user", () => {
    const { flow, sections, render } = setup()
    sections.register({
      ...section("web", 100),
      badge: () => value({ tone: "success", label: () => "Ready" }),
    })
    flow.open("web")
    expect(render()).not.toContain("data-dshb-settings-badge")
  })

  it("stays as it is, out of reach, under a screen opened over it", () => {
    const { flow, sections, render, cover } = setup()
    sections.register(section("web", 100))
    flow.open("web")
    cover(["global", "bot"])
    const html = render()
    expect(html).toContain("data-covered")
    expect(html).toContain('inert=""')
    expect(html).toContain("web body x")
  })

  it("draws a detail page with the way back named after its section", () => {
    const { flow, sections, render } = setup()
    sections.register(section("web", 100))
    flow.open("web", "key")
    const html = render()
    expect(html).toContain('data-dshb-settings-detail="key"')
    expect(html).toMatch(/data-dshb-page-back=""[^>]*>.*web<\/button>/)
  })

  it("asks a section's confirmation in the same frame", async () => {
    const { flow, sections, render } = setup()
    sections.register(section("web", 100))
    flow.open("web")
    const answer = flow.confirm({
      title: "Remove the key?",
      description: "Bots lose web lookup.",
      confirm: "Remove",
      tone: "danger",
    })
    const html = render()
    expect(html).toContain("data-dshb-settings-confirm")
    expect(html).toContain("Remove the key?")
    expect(html).toMatch(
      /data-variant="primary" data-tone="danger"[^>]*data-dshb-settings-confirm-accept/,
    )
    flow.answer(true)
    await expect(answer).resolves.toBe(true)
    expect(render()).not.toContain("data-dshb-settings-confirm")
  })
})

describe("DSH settings page", () => {
  it("is one row with the way to the dsh-bots settings", () => {
    const html = renderToStaticMarkup(
      createElement(DshSettingsPage, { t, close() {}, openGlobalSettings() {} }),
    )
    expect(html).toContain("section.globalSettings")
    expect(html).toMatch(/data-variant="row"[^>]*data-dshb-dsh-settings-open="">dshSettings.open/)
    expect(html).not.toContain("<p")
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain("<input")
  })

  it("closes DSH's settings, then opens the dsh-bots settings", () => {
    const calls: string[] = []
    const open = vi.fn(() => calls.push("open"))
    leaveForGlobalSettings({ close: () => calls.push("close") }, { openGlobalSettings: open })
    expect(calls).toEqual(["close", "open"])
  })
})
