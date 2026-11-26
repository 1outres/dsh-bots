import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionsFeed } from "../src/client/connections-model"
import { en, ja } from "../src/client/i18n"
import {
  createChannelDrafts,
  draftView,
  emptyDraft,
  withChange,
} from "../src/client/onboarding/channel-drafts"
import type { OnboardingClient } from "../src/client/onboarding/client"
import { OnboardingLayer } from "../src/client/onboarding/OnboardingLayer"
import { onboardingOverlay, positionOf, wizardSteps } from "../src/client/onboarding/steps"
import type { Translate } from "../src/client/types"
import type { WebLookupFeed } from "../src/client/web/feed"
import { welcomeLanding } from "../src/client/wiring/onboarding"
import type { BotChannel } from "../src/contract"
import { createWelcomeChannels } from "../src/host/onboarding/channels"
import { ONBOARDING_STATE_KEY, type OnboardingRecord } from "../src/host/onboarding/domain"
import { followWelcomeBot } from "../src/host/onboarding/follow"
import {
  initialRecord,
  type PriorInstallation,
  seenAfterAcknowledging,
} from "../src/host/onboarding/initial"
import { createReleaseNotesKeeper } from "../src/host/onboarding/notes"
import { createOnboardingPanel } from "../src/host/onboarding/panel"
import {
  fetchDueNotes,
  type HttpFetch,
  MAX_RELEASE_PAGES,
  RELEASES_PER_PAGE,
} from "../src/host/onboarding/releases"
import { releaseSourceOf } from "../src/host/onboarding/source"
import { openOnboardingStore } from "../src/host/onboarding/store"
import { finishing, welcomeAfter } from "../src/host/onboarding/welcome"
import type { BotTable } from "../src/host/registry"
import type { BotCreationOffer, BotsSnapshot } from "../src/shared/bots"
import {
  type BotChannelChange,
  type BotChannelDescriptor,
  checkChannelDescriptor,
} from "../src/shared/channels"
import type { BotModelCatalog } from "../src/shared/models"
import type { BotOnboardingView } from "../src/shared/onboarding"
import { compareVersions, NO_VERSION, type ReleaseNote } from "../src/shared/release-notes"
import { idleQueries } from "./channels-support"
import { bot, creating, t, value } from "./support/client"

const CHAT: BotChannelDescriptor = {
  id: "chat",
  name: "Chat",
  fields: [
    {
      key: "token",
      kind: "secret",
      agent: { note: "Test secret." },
      label: { en: "Token" },
      required: true,
      maxLength: 100,
    },
    {
      key: "owners",
      kind: "list",
      agent: { note: "Test setting.", change: "free" },
      label: { en: "Owners" },
      minItems: 1,
      maxItems: 5,
      item: { maxLength: 20, pattern: "\\d+" },
    },
  ],
  owners: "owners",
}

const CHAT_CHANGE: BotChannelChange = {
  enabled: true,
  values: { owners: ["42"] },
  secrets: { token: { op: "set", value: "secret" } },
}

function welcomeChannels() {
  const channel = {
    ...CHAT,
    capabilities: {},
    connect: () => ({ close() {} }),
  } as unknown as BotChannel
  return createWelcomeChannels({
    catalog: {
      list: () => [channel],
      get: (id) => (id === channel.id ? channel : undefined),
      subscribe: () => () => {},
    },
  })
}

const NEW: PriorInstallation = { bots: false, webSettings: false, oauthClients: false }
const note = (version: string): ReleaseNote => ({
  version,
  body: `Notes of ${version}`,
  url: `https://github.com/o/r/releases/tag/v${version}`,
})
const NOTES = [note("0.5.0"), note("0.4.0"), note("0.3.0")]
const fixedNotes = (notes: readonly ReleaseNote[]) => ({
  notes: () => notes,
  subscribe: () => () => {},
})

function table(initial?: OnboardingRecord): BotTable<OnboardingRecord> & { writes: number } {
  const map = new Map<string, OnboardingRecord>()
  if (initial !== undefined) map.set(ONBOARDING_STATE_KEY, initial)
  const result = {
    writes: 0,
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    put: async (key: string, record: OnboardingRecord) => {
      result.writes += 1
      map.set(key, record)
    },
    delete: async (key: string) => map.delete(key),
  }
  return result
}

const open = (state: BotTable<OnboardingRecord>, prior = NEW, version = "0.5.0") =>
  openOnboardingStore({
    onboardingState: state,
    prior: () => prior,
    version,
    now: () => 7,
  })

const coreManifest = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"))

describe("dsh-bots versions", () => {
  it("are read from bot-core's manifest, the version of every package", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url))
    const versions = readdirSync(root).map(
      (name) =>
        (JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")) as { version: string })
          .version,
    )
    const source = releaseSourceOf(coreManifest())
    expect(new Set(versions)).toEqual(new Set([source.version]))
    expect(source.repository).toEqual({ owner: "1outres", name: "dsh-bots" })
  })

  it("refuse a manifest without a version or a GitHub repository", () => {
    expect(() => releaseSourceOf({ version: "1", repository: "https://github.com/o/r" })).toThrow(
      "version",
    )
    expect(() =>
      releaseSourceOf({ version: "1.0.0", repository: { url: "https://gitlab.com/o/r.git" } }),
    ).toThrow("not a GitHub repository URL")
    expect(releaseSourceOf({ version: "1.0.0", repository: "https://github.com/o/r" })).toEqual({
      version: "1.0.0",
      repository: { owner: "o", name: "r" },
    })
  })

  it("orders releases and prereleases as semver does, and refuses other text", () => {
    expect(compareVersions("0.3.0", "0.10.0")).toBeLessThan(0)
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0)
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0)
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
    expect(() => compareVersions("v1", "1.0.0")).toThrow("is not a MAJOR.MINOR.PATCH version")
  })
})

const release = (tag: string, body: string | null, draft = false) => ({
  tag_name: tag,
  draft,
  prerelease: false,
  body,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
})

function githubOf(pages: readonly unknown[][], status = 200) {
  const urls: string[] = []
  const fetch: HttpFetch = async (url) => {
    urls.push(url)
    const page = Number(new URL(url).searchParams.get("page"))
    return { ok: status === 200, status, json: async () => pages[page - 1] ?? [] }
  }
  return { fetch, urls }
}

const REPO = { owner: "o", name: "r" }

describe("release notes from GitHub", () => {
  const signal = new AbortController().signal

  it("reads the releases after the seen version up to the running one, newest first", async () => {
    const github = githubOf([
      [
        release("v0.6.0", "too new"),
        release("v0.5.0", "five"),
        release("image-20261124", "an image"),
        release("v0.4.1", "  "),
        release("v0.4.0", "four", true),
        release("v0.3.0", "three"),
        release("v0.2.0", "two"),
      ],
    ])
    const notes = await fetchDueNotes(
      { fetch: github.fetch, repository: REPO },
      "0.2.0",
      "0.5.0",
      signal,
    )
    expect(notes).toEqual([
      { version: "0.5.0", body: "five", url: "https://github.com/o/r/releases/tag/v0.5.0" },
      { version: "0.3.0", body: "three", url: "https://github.com/o/r/releases/tag/v0.3.0" },
    ])
    expect(github.urls).toEqual(["https://api.github.com/repos/o/r/releases?per_page=100&page=1"])
  })

  it("follows every page, and refuses more than it reads", async () => {
    const full = Array.from({ length: RELEASES_PER_PAGE }, (_, i) => release(`v0.0.${i + 1}`, "x"))
    const github = githubOf([full, [release("v0.1.0", "one")]])
    const notes = await fetchDueNotes(
      { fetch: github.fetch, repository: REPO },
      "0.0.100",
      "0.1.0",
      signal,
    )
    expect(notes.map((item) => item.version)).toEqual(["0.1.0"])
    expect(github.urls).toHaveLength(2)
    const endless = githubOf(Array.from({ length: MAX_RELEASE_PAGES + 1 }, () => full))
    await expect(
      fetchDueNotes({ fetch: endless.fetch, repository: REPO }, "0.0.0", "1.0.0", signal),
    ).rejects.toThrow(`more than ${MAX_RELEASE_PAGES} pages`)
  })

  it("rejects a refusal (a rate limit too) and an answer of another shape", async () => {
    await expect(
      fetchDueNotes(
        { fetch: githubOf([[]], 403).fetch, repository: REPO },
        "0.0.0",
        "1.0.0",
        signal,
      ),
    ).rejects.toThrow("GitHub answered 403")
    await expect(
      fetchDueNotes(
        { fetch: githubOf([[{ tag_name: 1 }]]).fetch, repository: REPO },
        "0.0.0",
        "1.0.0",
        signal,
      ),
    ).rejects.toThrow("release 0 lacks")
  })
})

describe("the release notes keeper", () => {
  function setup(seen: string, fetch: (seen: string) => Promise<readonly ReleaseNote[]>) {
    let current = seen
    const listeners = new Set<() => void>()
    const timers: { work: () => void; ms: number }[] = []
    const recorded: string[] = []
    const keeper = createReleaseNotesKeeper({
      version: "0.5.0",
      seen: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      fetch: (from) => fetch(from),
      record: async (version) => {
        recorded.push(version)
        current = version
        for (const listener of [...listeners]) listener()
      },
      later: (work, ms) => {
        timers.push({ work, ms })
        return () => {}
      },
      retry: { firstMs: 10, maxMs: 30 },
      warn: vi.fn(),
    })
    const move = (next: string) => {
      current = next
      for (const listener of [...listeners]) listener()
    }
    return { keeper, timers, recorded, move }
  }

  it("reads nothing while the seen version is the running one", async () => {
    const fetch = vi.fn(async () => NOTES)
    const { keeper } = setup("0.5.0", fetch)
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(keeper.notes()).toEqual([])
  })

  it("shows nothing and stores nothing until the notes are read, retrying with backoff", async () => {
    let fail = true
    const fetch = vi.fn(async () => {
      if (fail) throw new Error("offline")
      return [note("0.5.0")]
    })
    const { keeper, timers, recorded } = setup("0.3.0", fetch)
    const changed = vi.fn()
    keeper.subscribe(changed)
    await vi.waitFor(() => expect(timers).toHaveLength(1))
    expect(keeper.notes()).toEqual([])
    timers[0]?.work()
    await vi.waitFor(() => expect(timers).toHaveLength(2))
    expect(timers.map((timer) => timer.ms)).toEqual([10, 20])
    fail = false
    timers[1]?.work()
    await vi.waitFor(() => expect(keeper.notes()).toEqual([note("0.5.0")]))
    expect(changed).toHaveBeenCalledOnce()
    expect(recorded).toEqual([])
  })

  it("only records the running version when no release since the seen one has notes", async () => {
    const { recorded } = setup("0.3.0", async () => [])
    await vi.waitFor(() => expect(recorded).toEqual(["0.5.0"]))
  })

  it("reads once, and nothing more after the notes are acknowledged", async () => {
    const fetch = vi.fn(async () => [note("0.5.0"), note("0.4.0")])
    const { keeper, move, recorded } = setup("0.3.0", fetch)
    await vi.waitFor(() => expect(keeper.notes()).toHaveLength(2))
    move("0.5.0")
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledOnce()
    expect(recorded).toEqual([])
  })
})

describe("onboarding state", () => {
  it("opens the guide on a new installation and shows an existing one every note up to now", () => {
    expect(initialRecord(NEW, "0.5.0", 1)).toEqual({
      welcome: { status: "open" },
      notesSeen: "0.5.0",
      updatedAt: 1,
    })
    for (const prior of [
      { ...NEW, bots: true },
      { ...NEW, webSettings: true },
      { ...NEW, oauthClients: true },
    ]) {
      expect(initialRecord(prior, "0.5.0", 1)).toEqual({
        welcome: { status: "done", at: 1, how: "existing" },
        notesSeen: NO_VERSION,
        updatedAt: 1,
      })
    }
  })

  it("acknowledges up to what was shown, never back and never past the running version", () => {
    expect(seenAfterAcknowledging("0.3.0", "0.4.0", "0.5.0")).toBe("0.4.0")
    expect(seenAfterAcknowledging("0.4.0", "0.3.0", "0.5.0")).toBe("0.4.0")
    expect(seenAfterAcknowledging("0.3.0", "9.0.0", "0.5.0")).toBe("0.5.0")
  })

  it("stores the first start's record once and reads only what is stored after it", async () => {
    const state = table()
    const store = await open(state)
    expect(store.current().welcome).toEqual({ status: "open" })
    expect(state.writes).toBe(1)
    const prior = vi.fn(() => ({ ...NEW, bots: true }))
    await openOnboardingStore({
      onboardingState: state,
      prior,
      version: "0.5.0",
      now: () => 8,
    })
    expect(prior).not.toHaveBeenCalled()
    expect(state.writes).toBe(1)
  })

  it("settles the guide's bot from the bots list: done once listed, open again once discarded", () => {
    const welcome = { status: "creating", botId: "b", startedAt: 1 } as const
    const none: Pick<BotsSnapshot, "bots" | "pending"> = { bots: [], pending: [] }
    expect(welcomeAfter(welcome, { ...none, pending: [creating("b")] }, 2)).toBe(welcome)
    expect(welcomeAfter(welcome, { ...none, bots: [bot("b", "m")] }, 2)).toEqual({
      status: "done",
      at: 2,
      how: "created",
      botId: "b",
    })
    expect(welcomeAfter(welcome, none, 2)).toEqual({ status: "open" })
  })

  it("finishes later: an open guide without a bot, a creating one with its bot, a done one unchanged", async () => {
    const store = await open(table())
    const base = store.current()
    expect(finishing(base, 3).welcome).toEqual({ status: "done", at: 3, how: "later" })
    const creatingRecord: OnboardingRecord = {
      ...base,
      welcome: { status: "creating", botId: "b", startedAt: 1 },
    }
    expect(finishing(creatingRecord, 3).welcome).toEqual({
      status: "done",
      at: 3,
      how: "created",
      botId: "b",
    })
    const done = finishing(base, 3)
    expect(finishing(done, 4)).toBe(done)
  })
})

describe("onboarding panel", () => {
  const input = {
    name: "A",
    avatar: { kind: "character", character: "capsule", color: "#6366F1" },
    workstation: false,
    language: "en",
    timezone: "UTC",
  } as const

  it("creates one guide bot when two pages ask at once, and follows it to done", async () => {
    const store = await open(table())
    let next = 0
    const create = vi.fn(async () => `bot${++next}`)
    const panel = createOnboardingPanel({
      store,
      version: "0.5.0",
      notes: fixedNotes(NOTES),
      channels: welcomeChannels(),
      create,
      discard: vi.fn(),
      now: () => 9,
    })
    const [first, second] = await Promise.allSettled([
      panel.createBot(input, []),
      panel.createBot(input, []),
    ])
    expect(first).toEqual({ status: "fulfilled", value: { id: "bot1" } })
    expect(second).toMatchObject({ status: "rejected", reason: { code: "bot-onboarding/closed" } })
    expect(create).toHaveBeenCalledOnce()
    const bots = value<Pick<BotsSnapshot, "bots" | "pending">>({
      bots: [],
      pending: [creating("bot1")],
    })
    const stop = followWelcomeBot({
      store,
      bots: { snapshot: bots.getSnapshot, subscribe: bots.subscribe },
      now: () => 10,
      warn: vi.fn(),
    })
    bots.set({ bots: [bot("bot1", "m1")], pending: [] })
    await vi.waitFor(() => expect(panel.view().welcome).toEqual({ status: "done", botId: "bot1" }))
    stop()
  })

  it("stores nothing when the creation is refused", async () => {
    const state = table()
    const store = await open(state)
    const panel = createOnboardingPanel({
      store,
      version: "0.5.0",
      notes: fixedNotes(NOTES),
      channels: welcomeChannels(),
      create: async () => {
        throw new Error("no environment")
      },
      discard: vi.fn(),
      now: () => 9,
    })
    await expect(panel.createBot(input, [])).rejects.toThrow("no environment")
    expect(panel.view().welcome).toEqual({ status: "open" })
    expect(state.writes).toBe(1)
  })

  it("acknowledges notes idempotently and refuses what is not a version", async () => {
    const store = await open(table(), { ...NEW, bots: true })
    const panel = createOnboardingPanel({
      store,
      version: "0.5.0",
      notes: fixedNotes(NOTES),
      channels: welcomeChannels(),
      create: vi.fn(),
      discard: vi.fn(),
      now: () => 9,
    })
    expect(panel.view().releaseNotes.map((item) => item.version)).toEqual([
      "0.5.0",
      "0.4.0",
      "0.3.0",
    ])
    expect((await panel.acknowledgeReleaseNotes("0.5.0")).releaseNotes).toEqual([])
    expect((await panel.acknowledgeReleaseNotes("0.4.0")).releaseNotes).toEqual([])
    await expect(panel.acknowledgeReleaseNotes("latest")).rejects.toMatchObject({
      code: "gateway/bad-request",
    })
  })

  it("checks every channel setup before creating, and stores them for the new bot", async () => {
    const store = await open(table())
    const configured: string[] = []
    const channels = welcomeChannels()
    channels.attach(async (botId, channelId, change) => {
      configured.push(`${botId} ${channelId} ${JSON.stringify(change.secrets)}`)
    })
    const create = vi.fn(async () => "b1")
    const panel = createOnboardingPanel({
      store,
      version: "0.5.0",
      notes: fixedNotes(NOTES),
      channels,
      create,
      discard: vi.fn(),
      now: () => 9,
    })
    expect(panel.view().channels.map((channel) => channel.id)).toEqual(["chat"])
    await expect(
      panel.createBot(input, [
        { channelId: "chat", change: { enabled: true, values: {}, secrets: {} } },
      ]),
    ).rejects.toMatchObject({ code: "gateway/bad-request" })
    await expect(
      panel.createBot(input, [{ channelId: "other", change: CHAT_CHANGE }]),
    ).rejects.toMatchObject({
      code: "gateway/bad-request",
    })
    expect(create).not.toHaveBeenCalled()
    await panel.createBot(input, [{ channelId: "chat", change: CHAT_CHANGE }])
    expect(configured).toEqual(['b1 chat {"token":{"op":"set","value":"secret"}}'])
    expect(panel.view().welcome).toEqual({ status: "creating", botId: "b1" })
  })

  it("discards the bot and stays open when its channels cannot be stored", async () => {
    const store = await open(table())
    const channels = welcomeChannels()
    channels.attach(async () => {
      throw new Error("vault refused")
    })
    const discard = vi.fn(async () => {})
    const panel = createOnboardingPanel({
      store,
      version: "0.5.0",
      notes: fixedNotes(NOTES),
      channels,
      create: async () => "b1",
      discard,
      now: () => 9,
    })
    await expect(
      panel.createBot(input, [{ channelId: "chat", change: CHAT_CHANGE }]),
    ).rejects.toThrow("vault refused")
    expect(discard).toHaveBeenCalledWith("b1")
    expect(panel.view().welcome).toEqual({ status: "open" })
  })

  it("offers no channel while their settings cannot be stored", () => {
    const channels = welcomeChannels()
    expect(channels.descriptors()).toEqual([])
    expect(() => channels.parse([{ channelId: "chat", change: CHAT_CHANGE }])).toThrow(
      'channel "chat" cannot be set up now',
    )
    const listener = vi.fn()
    channels.subscribe(listener)
    const detach = channels.attach(async () => {})
    expect(channels.descriptors()).toHaveLength(1)
    expect(() =>
      channels.parse([
        { channelId: "chat", change: CHAT_CHANGE },
        { channelId: "chat", change: CHAT_CHANGE },
      ]),
    ).toThrow('channel "chat" is set up twice')
    detach()
    expect(channels.descriptors()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe("channel drafts of the welcome guide", () => {
  it("are off, incomplete or waiting for the bot as a bot's settings would be", async () => {
    expect(draftView(CHAT, { ...emptyDraft(CHAT), enabled: false }).status).toEqual({
      state: "off",
    })
    expect(draftView(CHAT, emptyDraft(CHAT)).status).toEqual({
      state: "incomplete",
      missing: ["token", "owners"],
    })
    const drafts = createChannelDrafts(idleQueries)
    await drafts.configure(CHAT, CHAT_CHANGE)
    expect(drafts.view(CHAT)).toMatchObject({
      secrets: { token: true },
      status: { state: "waiting" },
    })
    expect(drafts.ready([CHAT])).toBe(true)
    expect(drafts.setups([CHAT])).toEqual([{ channelId: "chat", change: CHAT_CHANGE }])
  })

  it("keep a secret until it is cleared, refuse what the Host would, and drop everything on clear", async () => {
    const drafts = createChannelDrafts(idleQueries)
    await drafts.configure(CHAT, CHAT_CHANGE)
    await drafts.configure(CHAT, { ...CHAT_CHANGE, secrets: {} })
    expect(drafts.view(CHAT).secrets).toEqual({ token: true })
    await drafts.configure(CHAT, { ...CHAT_CHANGE, secrets: { token: { op: "clear" } } })
    expect(drafts.ready([CHAT])).toBe(false)
    expect(drafts.setups([CHAT])).toEqual([])
    await expect(
      drafts.configure(CHAT, { ...CHAT_CHANGE, values: { owners: ["not an id"] } }),
    ).rejects.toThrow()
    await drafts.configure(CHAT, CHAT_CHANGE)
    drafts.clear()
    expect(drafts.getSnapshot().size).toBe(0)
    expect(drafts.view(CHAT).secrets).toEqual({ token: false })
  })

  it("apply a change over the draft like the Host over stored settings", () => {
    const draft = withChange(emptyDraft(CHAT), CHAT_CHANGE)
    expect(draft.secrets).toEqual({ token: "secret" })
    expect(withChange(draft, { ...CHAT_CHANGE, enabled: false, secrets: {} })).toMatchObject({
      enabled: false,
      secrets: { token: "secret" },
    })
  })
})

describe("channel setup steps", () => {
  it("are one to eight lines with English text", () => {
    expect(() => checkChannelDescriptor({ ...CHAT, setup: [{ en: "Do this" }] })).not.toThrow()
    expect(() => checkChannelDescriptor({ ...CHAT, setup: [] })).toThrow(
      "setup must list 1 to 8 steps",
    )
    expect(() => checkChannelDescriptor({ ...CHAT, setup: [{ en: " " }] })).toThrow(
      'channel "chat" setup step 1 has no English text',
    )
  })
})

const view = (
  welcome: BotOnboardingView["welcome"],
  notes: readonly ReleaseNote[] = [],
  channels: readonly BotChannelDescriptor[] = [],
): BotOnboardingView => ({
  version: "0.5.0",
  welcome,
  releaseNotes: notes,
  channels,
})

describe("onboarding in the browser", () => {
  it("shows the guide before the notes, and nothing once both are done", () => {
    expect(onboardingOverlay(undefined)).toBeNull()
    expect(onboardingOverlay(view({ status: "open" }, NOTES))?.kind).toBe("welcome")
    expect(onboardingOverlay(view({ status: "done" }, NOTES))?.kind).toBe("release-notes")
    expect(onboardingOverlay(view({ status: "done" }))).toBeNull()
  })

  it("leaves out setup pages with nothing to set up, and moves past a page that left", () => {
    const all = wizardSteps({ web: true, accounts: true, channels: true })
    expect(all).toEqual(["welcome", "web", "accounts", "channels", "bot"])
    const bare = wizardSteps({ web: false, accounts: false, channels: false })
    expect(bare).toEqual(["welcome", "bot"])
    expect(positionOf(bare, "channels")).toBe(1)
    expect(positionOf(all, "channels")).toBe(3)
  })

  it("hands the guide the channels the Host offers", () => {
    expect(onboardingOverlay(view({ status: "open" }, [], [CHAT]))).toEqual({
      kind: "welcome",
      welcome: { status: "open" },
      channels: [CHAT],
    })
  })

  it("lands on the bot's Main once listed, on its creation until then, nowhere without a bot", () => {
    const snapshot: BotsSnapshot = {
      bots: [bot("b", "main-b")],
      pending: [],
      preparingSessionIds: [],
    }
    expect(welcomeLanding({ status: "done", botId: "b" }, snapshot)).toEqual({
      kind: "main",
      sessionId: "main-b",
    })
    expect(welcomeLanding({ status: "done", botId: "c" }, snapshot)).toEqual({
      kind: "progress",
      botId: "c",
    })
    expect(welcomeLanding({ status: "done" }, snapshot)).toBeNull()
  })

  const dictionary =
    (messages: Readonly<Record<string, string>>): Translate =>
    (key, params) => {
      const message = messages[key]
      if (message === undefined) throw new Error(`missing message ${key}`)
      return Object.entries(params ?? {}).reduce(
        (text, [name, v]) => text.replace(`{${name}}`, String(v)),
        message,
      )
    }

  function render(current: BotOnboardingView, translate: Translate = t) {
    const onboarding = {
      ...value<BotOnboardingView | undefined>(current),
      createBot: vi.fn(),
      finishWelcome: vi.fn(),
      acknowledgeReleaseNotes: vi.fn(),
      dispose: vi.fn(),
    } satisfies OnboardingClient
    const web = {
      ...value({ status: "loading" as const }),
      setEnabled: vi.fn(),
      setSecret: vi.fn(),
      test: vi.fn(),
    } satisfies WebLookupFeed
    const connections = {
      ...value({ status: "loading" as const }),
      configureClient: vi.fn(),
      authorize: vi.fn(),
      rename: vi.fn(),
      assign: vi.fn(),
      disconnect: vi.fn(),
    } satisfies ConnectionsFeed
    return renderToStaticMarkup(
      createElement(OnboardingLayer, {
        t: translate,
        onboarding,
        bots: value({ status: "loading" as const }),
        pending: {
          retryCreate: vi.fn(),
          discardCreate: vi.fn(),
          retryRemove: vi.fn(),
          dismissRemove: vi.fn(),
        },
        creation: {
          creationOptions: () => new Promise<BotCreationOffer>(() => {}),
          modelCatalog: () => new Promise<BotModelCatalog>(() => {}),
        },
        web,
        text: (text: { readonly en: string }) => text.en,
        connections,
        channelQueries: idleQueries,
      }),
    )
  }

  it("draws the welcome page as a dialog with no way to close it, its features as cards", () => {
    const html = render(view({ status: "open" }))
    expect(html).toContain('data-dshb-welcome="open"')
    expect(html).toContain('data-dshb-welcome-step="welcome"')
    expect(html).toContain('data-dshb-art="welcome"')
    expect(html.match(/data-feature="(\w+)"/g)).toEqual([
      'data-feature="bots"',
      'data-feature="vm"',
      'data-feature="main"',
      'data-feature="google"',
    ])
    expect(html).toContain("welcome.start")
    expect(html).not.toContain("form.close")
  })

  it("welcomes in English in every language", () => {
    expect(render(view({ status: "open" }), dictionary(ja))).toContain("Welcome to dsh-bots!")
    expect(ja["welcome.title"]).toBe(en["welcome.title"])
  })

  it("draws the creation page while the guide's bot is being created", () => {
    const html = render(view({ status: "creating", botId: "b" }))
    expect(html).toContain('data-dshb-welcome-step="creating"')
    expect(html).toContain("welcome.creating.background")
  })

  it("draws each release's Markdown as written, never as HTML, with only OK", () => {
    const html = render(
      view({ status: "done" }, [
        {
          version: "0.5.0",
          body: "## Added\n\n- **Bold** [page](https://example.com/)\n- <script>alert(1)</script>",
          url: "https://github.com/o/r/releases/tag/v0.5.0",
        },
      ]),
      dictionary(ja),
    )
    expect(html).toContain("<h2>Added</h2>")
    expect(html).toContain("<strong>Bold</strong>")
    expect(html).toContain('href="https://example.com/" target="_blank"')
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("dsh-bots が新しくなりました")
    expect(html).toContain('data-dshb-release-ok=""')
    expect(render(view({ status: "done" }, [note("0.5.0")]), dictionary(en))).toContain(
      "Version 0.5.0",
    )
  })
})
