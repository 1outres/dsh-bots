import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FeedState, MainsClient } from "../src/client/mains/client"
import { BotMainsSection, GlobalMainsSection } from "../src/client/mains/MainsSections"
import { fieldValues, overriddenFields, overrideOf, settingsOf } from "../src/client/mains/model"
import {
  type BotMainsView,
  DEFAULT_MAIN_ROTATION,
  effectiveMainRotation,
} from "../src/shared/mains"
import { bot, t, value } from "./support/client"

const frame = {
  t,
  page: { detail: null, open() {}, back() {} },
  close() {},
  confirm: async () => true,
}

const override = { quietMinutes: 3, daily: { enabled: false }, memoryFlush: { enabled: false } }
const view: BotMainsView = {
  botId: "a",
  defaults: DEFAULT_MAIN_ROTATION,
  override,
  effective: effectiveMainRotation(DEFAULT_MAIN_ROTATION, override),
  status: { sessionId: "m-a", startedAt: 0, compactions: 2, maintenance: "idle" },
}

function client(state: FeedState<BotMainsView>): Pick<MainsClient, "bot" | "configure"> {
  return { bot: () => value(state), configure: async () => view }
}

describe("Main session settings", () => {
  it("round-trips the fields of settings and overrides", () => {
    expect(settingsOf(fieldValues(DEFAULT_MAIN_ROTATION))).toEqual(DEFAULT_MAIN_ROTATION)
    const own = overriddenFields(override)
    expect([...own]).toEqual(["quietMinutes", "daily.enabled", "memoryFlush.enabled"])
    expect(overrideOf(fieldValues(view.effective), own)).toEqual(override)
  })

  it("shows a bot's own values as Custom, with the default beside them and a reset", () => {
    const html = renderToStaticMarkup(
      createElement(BotMainsSection, {
        ...frame,
        bot: bot("a", "m-a"),
        mains: client({ status: "ready", value: view }),
        startNewMain() {},
      }),
    )
    expect(html).toContain('data-dshb-mains-own="quietMinutes"')
    expect(html).toContain('data-dshb-mains-reset="daily.enabled"')
    expect(html).toContain('data-dshb-mains-own="memoryFlush.enabled"')
    expect(html).not.toContain('data-dshb-mains-own="longIdle.minutes"')
    expect(html).toContain("mains.defaultValue")
    expect(html).toContain('data-dshb-mains-new=""')
    expect(html).not.toContain("<form")
  })

  it("edits the defaults without a save button", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalMainsSection, {
        ...frame,
        mains: {
          defaults: value<FeedState<typeof DEFAULT_MAIN_ROTATION>>({
            status: "ready",
            value: DEFAULT_MAIN_ROTATION,
          }),
          setDefaults: async (settings) => settings,
        },
      }),
    )
    expect(html).toContain('data-dshb-mains-field="daily.time"')
    expect(html).toContain('data-dshb-mains-field="memoryFlush.enabled"')
    expect(html).toContain("mains.group.memory")
    expect(html).not.toContain("form.save")
    expect(html).not.toContain("mains-own")
  })
})
