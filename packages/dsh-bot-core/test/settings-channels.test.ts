import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { askAbout } from "../src/client/channel-queries"
import { type ChannelsFeed, createChannelsHub } from "../src/client/channels-hub"
import type { ChannelsModel, ChannelsState } from "../src/client/channels-model"
import { createStore } from "../src/client/observable"
import { ChannelsSection } from "../src/client/settings/ChannelsSection"
import { channelsBadge } from "../src/client/settings/channels-badge"
import type {
  BotChannelProfileView,
  BotChannelStatus,
  BotChannelView,
} from "../src/shared/channels"
import { FIELDS, idleQueries } from "./channels-support"
import { bot, t } from "./support/client"

function fakeModel() {
  const state = createStore<ChannelsState>({ status: "loading" })
  const model: ChannelsModel & { state: typeof state } = {
    state,
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    configure: vi.fn(async () => ({}) as BotChannelView),
    dispose: vi.fn(),
  }
  return model
}

const view = (id: string, status: BotChannelStatus): BotChannelView => ({
  channel: { id, name: id, fields: [] },
  enabled: status.state !== "off",
  values: {},
  secrets: {},
  status,
  revision: 0,
})

const ready = (...statuses: BotChannelStatus[]): ChannelsState => ({
  status: "ready",
  snapshot: { botId: "x", channels: statuses.map((status, index) => view(`c${index}`, status)) },
})

describe("channels hub", () => {
  it("opens one stream per bot for every subscriber and closes it after the last", () => {
    const models: ReturnType<typeof fakeModel>[] = []
    const open = vi.fn(() => {
      const model = fakeModel()
      models.push(model)
      return model
    })
    const hub = createChannelsHub(open, idleQueries)
    const feed = hub.feed("x")
    expect(hub.feed("x")).toBe(feed)
    expect(feed.getSnapshot()).toEqual({ status: "loading" })
    expect(open).not.toHaveBeenCalled()

    const heard = vi.fn()
    const offA = feed.subscribe(heard)
    const offB = feed.subscribe(() => {})
    expect(open).toHaveBeenCalledTimes(1)
    models[0]?.state.set(ready({ state: "off" }))
    expect(heard).toHaveBeenCalledTimes(1)
    expect(feed.getSnapshot()).toBe(models[0]?.getSnapshot())

    offA()
    expect(models[0]?.dispose).not.toHaveBeenCalled()
    offB()
    expect(models[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(feed.getSnapshot()).toEqual({ status: "loading" })
    feed.subscribe(() => {})
    expect(open).toHaveBeenCalledTimes(2)
  })

  it("saves through the followed stream and refuses while nothing follows it", async () => {
    const model = fakeModel()
    const hub = createChannelsHub(() => model, idleQueries)
    const change = { enabled: true, values: {}, secrets: {}, profileSync: false }
    await expect(hub.feed("x").configure("discord", change)).rejects.toThrow(/not followed/)
    const off = hub.feed("x").subscribe(() => {})
    await hub.feed("x").configure("discord", change)
    expect(model.configure).toHaveBeenCalledWith("discord", change)
    off()
  })
})

describe("channelsBadge", () => {
  const tone = (state: ChannelsState) => channelsBadge(state)?.tone

  it("shows nothing while loading, failed to load, or every channel is off", () => {
    expect(channelsBadge({ status: "loading" })).toBeNull()
    expect(
      channelsBadge({ status: "failed", failure: { kind: "connection", message: "x" } }),
    ).toBeNull()
    expect(channelsBadge(ready())).toBeNull()
    expect(channelsBadge(ready({ state: "off" }))).toBeNull()
  })

  it("colors each state: connected green, failed red, incomplete amber, connecting gray", () => {
    expect(tone(ready({ state: "connected" }))).toBe("success")
    expect(tone(ready({ state: "failed", message: "bad token" }))).toBe("danger")
    expect(tone(ready({ state: "incomplete", missing: ["token"] }))).toBe("warning")
    expect(tone(ready({ state: "connecting" }))).toBe("pending")
    expect(tone(ready({ state: "waiting" }))).toBe("pending")
    expect(channelsBadge(ready({ state: "connected" }))?.label(t)).toBe("settings.badge.connected")
  })

  it("shows the worst state among the channels", () => {
    expect(tone(ready({ state: "connected" }, { state: "failed", message: "x" }))).toBe("danger")
    expect(tone(ready({ state: "connected" }, { state: "connecting" }))).toBe("pending")
    expect(tone(ready({ state: "off" }, { state: "connected" }))).toBe("success")
  })

  it("keeps one badge per state, so readers see a stable value", () => {
    expect(channelsBadge(ready({ state: "connected" }))).toBe(
      channelsBadge(ready({ state: "connected" })),
    )
  })
})

describe("channels section", () => {
  const render = (
    users: readonly string[],
    status: BotChannelStatus = { state: "connected" },
    profile?: BotChannelProfileView,
  ) => {
    const state = createStore<ChannelsState>({
      status: "ready",
      snapshot: {
        botId: "x",
        channels: [
          {
            channel: {
              id: "chat",
              name: "Chat",
              guide: "https://example.com/guide",
              fields: [
                ...FIELDS,
                {
                  kind: "text",
                  agent: { note: "Test setting.", change: "free" },
                  key: "language",
                  label: { en: "Language" },
                  required: false,
                  maxLength: 2,
                  choices: [
                    { value: "", label: { en: "Default" } },
                    { value: "ja", label: { en: "Japanese" } },
                  ],
                },
              ],
              owners: "users",
            },
            enabled: true,
            values: { server: "", users, language: "ja" },
            secrets: { token: true },
            status,
            revision: 0,
            ...(profile === undefined ? {} : { profile }),
          },
        ],
      },
    })
    const feed: ChannelsFeed = { ...state, configure: vi.fn() }
    return renderToStaticMarkup(
      createElement(ChannelsSection, {
        t,
        bot: bot("x", "main-x"),
        page: { detail: null, open() {}, back() {} },
        close: () => {},
        confirm: async () => false,
        openShared: () => {},
        channels: {
          feed: () => feed,
          ask: (_botId, channelId) =>
            askAbout(idleQueries, channelId, () => ({ kind: "bot", botId: "x" })),
        },
        text: (text) => text.en,
      }),
    )
  }

  it("heads each channel with its state and its switch; every field a row saved on its own", () => {
    const html = render(["1"])
    expect(html).toContain('data-dshb-channel="chat"')
    expect(html).toContain('data-dshb-channel-state="connected"')
    expect(html).toMatch(/aria-checked="true" aria-label="channels.enabled\(Chat\)"/)
    expect(html).toContain('data-dshb-secret="set"')
    expect(html).toMatch(/<textarea[^>]*data-dshb-channel-field="users"/)
    expect(html).toMatch(/<select[^>]*data-dshb-channel-field="language"/)
    expect(html).toContain('<option value="ja" selected="">Japanese</option>')
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).not.toContain('type="submit"')
  })

  it("shows an empty owners field as the row's and the channel's warning", () => {
    const empty = render([])
    expect(empty).toContain('data-dshb-channel-state="noOwners"')
    expect(empty).toContain("channels.owners.none")
    expect(empty).toContain('data-flag="warning"')
    const owned = render(["1"])
    expect(owned).not.toContain("channels.owners.none")
    expect(owned).not.toContain('data-flag="warning"')
  })

  it("offers the profile sync only for a channel that takes it, with what the channel reported", () => {
    expect(render(["1"])).not.toContain("data-dshb-channel-profile")
    const both = { name: true, avatar: true }
    const off = render(["1"], undefined, { supports: both, sync: false })
    expect(off).toContain('data-dshb-channel-profile="off"')
    expect(off).toContain("channels.profile.both")
    expect(off).toMatch(/aria-checked="false" aria-label="channels.profile.toggle\(Chat\)"/)
    const failed = render(["1"], undefined, {
      supports: { name: true, avatar: false },
      sync: true,
      status: { state: "failed", problems: [{ en: "Discord refused the username" }] },
    })
    expect(failed).toContain('data-dshb-channel-profile="failed"')
    expect(failed).toContain("channels.profile.name")
    expect(failed).toContain("channels.profile.failed — Discord refused the username")
  })

  it("marks the required fields a channel misses", () => {
    const html = render(["1"], { state: "incomplete", missing: ["users"] })
    expect(html).toContain('data-dshb-channel-state="incomplete"')
    expect(html).toContain("channels.missing")
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/)
  })
})
