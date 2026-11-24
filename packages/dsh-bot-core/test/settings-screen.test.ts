import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createChannelsHub } from "../src/client/channels-hub"
import type { ChannelsModel } from "../src/client/channels-model"
import { createConnectorsHub } from "../src/client/connectors-hub"
import type { ConnectorsModel } from "../src/client/connectors-model"
import { createModelsHub } from "../src/client/models/feed"
import { createStore } from "../src/client/observable"
import type { BotsState } from "../src/client/session-classification"
import { builtinSettingsSections, SETTINGS_SECTION } from "../src/client/settings/builtin"
import { createSettingsFlow, type SettingsTarget } from "../src/client/settings/flow"
import { GeneralSection } from "../src/client/settings/GeneralSection"
import { SettingsScreen } from "../src/client/settings/SettingsScreen"
import { createSettingsSections, type SettingsSection } from "../src/client/settings/sections"
import type { SettingsScreenId } from "../src/client/wiring/screens"
import { bot, t, value } from "./support/client"
import { idleConnections } from "./support/connectors-client"

const target = bot("x", "m1")
const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
]
const READY: BotsState = {
  status: "ready",
  snapshot: { bots: [target], pending: [], preparingSessionIds: [] },
}

const unused = async (): Promise<never> => {
  throw new Error("unused")
}

function screen(extra: SettingsSection[] = []) {
  const sections = createSettingsSections()
  const model = {
    ...value({ status: "loading" as const }),
    configure: async () => {
      throw new Error("unused")
    },
    dispose() {},
  } satisfies ChannelsModel
  const connectors = {
    ...value({ status: "loading" as const }),
    configure: unused,
    setPermission: unused,
    retry: unused,
    dispose() {},
  } satisfies ConnectorsModel
  for (const section of builtinSettingsSections({
    saveBot: async () => {},
    deleteBot: () => {},
    languages: () => LANGUAGES,
    channels: createChannelsHub(() => model),
    connectors: createConnectorsHub(() => connectors),
    connections: idleConnections(),
    models: createModelsHub(() => ({
      ...value({ status: "loading" as const }),
      configure: unused,
      dispose() {},
    })),
    workspaces: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
      options: unused,
      grant: unused,
      configure: unused,
      revoke: unused,
      dispose() {},
    },
    readCatalog: unused,
    openConnectionSettings: () => {},
    text: (text) => text.en,
  })) {
    sections.register(section)
  }
  for (const section of extra) sections.register(section)
  const store = createStore<SettingsTarget | null>(null)
  const flow = createSettingsFlow(store, sections)
  const render = () =>
    renderToStaticMarkup(
      createElement(SettingsScreen, {
        t,
        bots: value(READY),
        flow,
        sections,
        stack: value<readonly SettingsScreenId[]>(["bot"]),
      }),
    )
  return { flow, render }
}

describe("SettingsScreen", () => {
  it("draws nothing while closed", () => {
    expect(screen().render()).toBe("")
  })

  it("is a modal popover titled by the bot on one line, with a vertical tab list of the sections", () => {
    const { flow, render } = screen()
    flow.open("x")
    const html = render()
    expect(html).toContain('data-layout="wide"')
    expect(html).toContain('class="dshb-settings-mask"')
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+-title"/)
    expect(html).toMatch(/<header class="dshb-settings-header"><span[^>]*dshb-avatar/)
    expect(html).not.toContain("kicker")
    expect(html).toContain('data-bot-id="x"')
    expect(html).toContain("Bot x")
    expect(html).toContain('aria-label="settings.close"')
    expect(html).toContain('role="tablist" aria-orientation="vertical"')
    expect(html.match(/role="tab"/g)).toHaveLength(5)
    expect(html).toMatch(/aria-selected="true"[^>]*data-dshb-settings-tab="bot-core.general"/)
    expect(html).toMatch(/role="tabpanel" id="[^"]+" aria-labelledby="[^"]+-tab-bot-core.general"/)
    expect(html).toContain(`data-dshb-settings-section="${SETTINGS_SECTION.general}"`)
    expect(html).toContain('value="Bot x"')
    expect(html).not.toContain("data-dshb-settings-discard")
  })

  it("draws any registered section, at its order", () => {
    const { flow, render } = screen([
      {
        id: "test.vm",
        order: 300,
        label: () => "VM",
        icon: () => null,
        component: ({ bot }) => createElement("p", null, `vm of ${bot.id}`),
        badge: () => value({ tone: "warning", label: () => "VM stopped" }),
      },
    ])
    flow.open("x", "test.vm")
    const html = render()
    const tabs = [...html.matchAll(/data-dshb-settings-tab="([^"]+)"/g)].map((match) => match[1])
    expect(tabs).toEqual([
      SETTINGS_SECTION.general,
      SETTINGS_SECTION.models,
      SETTINGS_SECTION.workspaces,
      SETTINGS_SECTION.channels,
      SETTINGS_SECTION.connectors,
      "test.vm",
    ])
    expect(html).toContain("vm of x")
    expect(html).toMatch(/data-tone="warning" title="VM stopped"/)
  })

  it("asks before dropping typed text, the discarding button filled red", () => {
    const { flow, render } = screen()
    flow.open("x")
    flow.edits.hold()
    expect(render()).not.toContain("data-dshb-settings-discard")
    flow.select(SETTINGS_SECTION.connectors)
    const asking = render()
    expect(asking).toMatch(/role="alertdialog" aria-modal="true"/)
    expect(asking).toContain('data-dshb-settings-discard="move"')
    expect(asking).toContain("settings.discard.description(settings.general)")
    expect(asking).toMatch(
      /data-variant="primary" data-tone="danger"[^>]*>settings.discard.confirm/,
    )
    flow.keepEditing()
    flow.close()
    expect(render()).toContain("settings.discard.close")
  })
})

describe("SettingsScreen confirmations", () => {
  it("shows a section's confirmation with its texts over the screen", () => {
    const { flow, render } = screen()
    flow.open("x", SETTINGS_SECTION.connectors)
    void flow.confirm({
      title: "Allow it?",
      description: "Really.",
      confirm: "Allow",
      tone: "danger",
    })
    const html = render()
    expect(html).toContain("data-dshb-settings-confirm")
    expect(html).toContain("Allow it?")
    expect(html).toContain("settings.confirm.cancel")
    expect(html).toMatch(/data-variant="primary" data-tone="danger"[^>]*>Allow</)
    flow.answer(false)
    expect(render()).not.toContain("data-dshb-settings-confirm")
  })
})

describe("sections", () => {
  const props = {
    t,
    bot: target,
    page: { detail: null, open() {}, back() {} },
    close: () => {},
    confirm: async () => false,
  }

  const general = (language?: string) =>
    renderToStaticMarkup(
      createElement(GeneralSection, {
        ...props,
        bot: { ...props.bot, ...(language === undefined ? {} : { language }) },
        saveBot: async () => {},
        deleteBot: () => {},
        languages: () => LANGUAGES,
      }),
    )

  it("General saves the name, the avatar, the time zone and the language as they change, and ends in Delete", () => {
    const html = general()
    expect(html).toContain('value="Bot x"')
    expect(html).toContain("form.timezone")
    expect(html).toMatch(/role="combobox" aria-label="form.timezone"[^>]*>.*UTC/)
    expect(html).toContain('aria-label="form.language"')
    expect(html).toContain('role="radiogroup"')
    expect(html).not.toContain('type="submit"')
    expect(html).toMatch(/data-kind="action"[^>]*data-tone="danger"[^>]*data-dshb-general-delete/)
    expect(html).toContain("settings.delete.open")
  })

  it("General offers DSH's languages, and Not set only while the bot has none", () => {
    const unset = general()
    expect(unset).toMatch(/<option value="" disabled="" selected="">form.languageUnset<\/option>/)
    expect(unset).toContain(">日本語</option>")
    const chosen = general("ja")
    expect(chosen).not.toContain("form.languageUnset")
    expect(chosen).toMatch(/<option value="ja" selected="">日本語<\/option>/)
    expect(general("fr")).toContain('<option value="fr" selected="">fr</option>')
  })
})
