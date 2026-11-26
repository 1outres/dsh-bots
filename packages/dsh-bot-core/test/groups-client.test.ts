import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { GroupMessagesPage } from "../src/client/groups/GroupMessagesPage"
import { GroupsSection } from "../src/client/groups/GroupsSection"
import { MembershipRow, membershipText } from "../src/client/groups/MembershipRow"
import { appendEarlier, createGroupMessages, readPages } from "../src/client/groups/messages"
import {
  createGroupsFeed,
  GroupsError,
  type GroupsFeed,
  type GroupsState,
} from "../src/client/groups/model"
import {
  groupOfDetail,
  groupsBadge,
  isLongMessage,
  joinChoices,
  membershipOf,
  messagePill,
  messageReason,
  messagesDetail,
  pauseDetail,
  pausePill,
  selectableBots,
  threadsOf,
} from "../src/client/groups/view"
import { en } from "../src/client/i18n"
import { GROUPS_EN, GROUPS_JA } from "../src/client/i18n-groups"
import { createStore } from "../src/client/observable"
import type { BotCoreRemote, RemoteMount } from "../src/client/remote"
import type { BotsState } from "../src/client/session-classification"
import type { BotsSnapshot } from "../src/shared/bots"
import type {
  BotGroupsSnapshot,
  BotGroupView,
  BotPeerMessagePage,
  BotPeerMessageView,
} from "../src/shared/peers"
import { bot, creating, t, value } from "./support/client"

const nova = bot("nova", "m-nova")
const pico = bot("pico", "m-pico")
const kiri = bot("kiri", "m-kiri")

const group = (id: string, name: string, change: Partial<BotGroupView> = {}): BotGroupView => ({
  id,
  name,
  purpose: "",
  members: [],
  activity: { messages: 0, queued: 0 },
  createdAt: 1,
  ...change,
})

const member = (botId: string, role = "") => ({ botId, role, joinedAt: 2 })

const message = (id: string, change: Partial<BotPeerMessageView> = {}): BotPeerMessageView => ({
  id,
  groupId: "g1",
  from: "nova",
  to: "pico",
  threadId: id,
  expectsReply: true,
  depth: 0,
  text: "hello",
  sentAt: 10,
  state: "delivered",
  ...change,
})

const research = group("g1", "Research", { members: [member("nova", "drafts"), member("pico")] })
const ops = group("g2", "Ops", { members: [member("kiri")] })
const SNAPSHOT: BotGroupsSnapshot = { groups: [research, ops] }

const BOTS: BotsSnapshot = {
  bots: [nova, pico, kiri, bot("solo", "m-solo")],
  pending: [creating("egg")],
  preparingSessionIds: [],
}

const READY_BOTS: BotsState = { status: "ready", snapshot: BOTS }

const unused = async (): Promise<never> => {
  throw new Error("unused")
}

function feedOf(state: GroupsState, change: Partial<GroupsFeed> = {}): GroupsFeed {
  return {
    ...value(state),
    create: unused,
    update: unused,
    deleteGroup: unused,
    join: unused,
    leave: unused,
    setRole: unused,
    setPaused: unused,
    messages: unused,
    ...change,
  }
}

const sectionProps = (detail: string | null = null) => ({
  t,
  page: { detail, open() {}, back() {} },
  close() {},
  confirm: async () => true,
})

describe("group views", () => {
  it("finds a bot's group and role, and lists only bots that are not being created or deleted", () => {
    expect(membershipOf(SNAPSHOT, "nova")).toEqual({
      group: research,
      member: member("nova", "drafts"),
    })
    expect(membershipOf(SNAPSHOT, "solo")).toBeUndefined()
    expect(
      selectableBots({ ...BOTS, bots: [...BOTS.bots, bot("egg", "m-egg")] }).map((each) => each.id),
    ).toEqual(["nova", "pico", "kiri", "solo"])
  })

  it("offers free bots first, then the bots of other groups under their group's heading", () => {
    expect(joinChoices(t, SNAPSHOT, BOTS.bots, "g1")).toEqual([
      { value: "solo", label: "Bot solo" },
      { value: "kiri", label: "Bot kiri", group: "groups.add.inGroup(Ops)" },
    ])
  })

  it("tells an owner's pause from a limit's, and shows the dot only for a limit", () => {
    const owner = { reason: "owner" as const, at: 5 }
    const limit = { reason: "limit" as const, at: 5, detail: "pair" as const }
    expect(pausePill(t, owner)).toEqual({ tone: "idle", label: "groups.paused.owner" })
    expect(pausePill(t, limit)).toEqual({ tone: "danger", label: "groups.paused.limit" })
    expect(pauseDetail(t, owner, () => "14:30")).toBe("14:30")
    expect(pauseDetail(t, limit, () => "14:30")).toBe("14:30 · groups.limit.pair")
    const ready = (groups: readonly BotGroupView[]): GroupsState => ({
      status: "ready",
      snapshot: { groups },
    })
    expect(groupsBadge(ready([group("a", "A", { paused: owner })]))).toBeNull()
    expect(groupsBadge({ status: "loading" })).toBeNull()
    const badge = groupsBadge(ready([group("a", "A"), group("b", "B", { paused: limit })]))
    expect(badge?.tone).toBe("danger")
    expect(badge?.label(t)).toBe("groups.badge.limit")
  })

  it("groups messages by thread, newest thread first, each thread oldest first", () => {
    const threads = threadsOf([
      message("p_1", { sentAt: 1 }),
      message("p_2", { sentAt: 2, threadId: "p_2" }),
      message("p_3", { sentAt: 3, threadId: "p_1", replyTo: "p_1", from: "pico", to: "nova" }),
    ])
    expect(threads.map((thread) => [thread.id, thread.messages.map((each) => each.id)])).toEqual([
      ["p_1", ["p_1", "p_3"]],
      ["p_2", ["p_2"]],
    ])
  })

  it("pills every state but delivered, with the reason of a refusal or a withdrawal", () => {
    expect(messagePill(t, message("a"))).toBeNull()
    expect(messagePill(t, message("a", { state: "queued" }))?.tone).toBe("busy")
    expect(messagePill(t, message("a", { state: "withdrawn" }))?.tone).toBe("idle")
    expect(messagePill(t, message("a", { state: "expired" }))?.tone).toBe("idle")
    expect(messagePill(t, message("a", { state: "refused" }))?.tone).toBe("danger")
    expect(messageReason(t, message("a", { state: "refused", refusal: "thread" }))).toBe(
      "groups.limit.thread",
    )
    expect(messageReason(t, message("a", { state: "refused", refusal: "paused" }))).toBe(
      "groups.refusal.paused",
    )
    expect(messageReason(t, message("a", { state: "withdrawn", withdrawal: "left-group" }))).toBe(
      "groups.withdrawal.left-group",
    )
    expect(messageReason(t, message("a"))).toBeUndefined()
  })

  it("folds a message longer than six lines", () => {
    expect(isLongMessage("1\n2\n3\n4\n5\n6")).toBe(false)
    expect(isLongMessage("1\n2\n3\n4\n5\n6\n7")).toBe(true)
    expect(isLongMessage("x".repeat(481))).toBe(true)
  })

  it("names the messages page after its group", () => {
    expect(groupOfDetail(messagesDetail("g1"))).toBe("g1")
    expect(groupOfDetail(null)).toBeUndefined()
    expect(groupOfDetail("other")).toBeUndefined()
  })
})

function pages(count: number): (before: string | undefined) => Promise<BotPeerMessagePage> {
  const all = Array.from({ length: count }, (_, index) =>
    message(`p_${String(index).padStart(3, "0")}`, { sentAt: index }),
  )
  return async (before) => {
    const end = before === undefined ? all.length : all.findIndex((each) => each.id === before)
    const start = Math.max(0, end - 40)
    const first = all[start]
    return {
      messages: all.slice(start, end),
      ...(start === 0 || first === undefined ? {} : { earlier: first.id }),
    }
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("group messages", () => {
  it("reads pages from the newest and puts an earlier page before the loaded ones", async () => {
    const read = pages(90)
    const first = await readPages(read, 1)
    expect(first.messages).toHaveLength(40)
    expect(first.earlier).toBe("p_050")
    const two = appendEarlier(first, await read(first.earlier))
    expect(two.messages[0]?.id).toBe("p_010")
    expect(two.messages).toHaveLength(80)
    expect((await readPages(read, 5)).messages).toHaveLength(90)
  })

  it("loads the newest page, then earlier ones, and refreshes as many pages as it shows", async () => {
    const read = vi.fn(pages(90))
    const model = createGroupMessages(read)
    model.refresh()
    expect(model.getSnapshot().status).toBe("loading")
    await settled()
    model.loadEarlier()
    await settled()
    const loaded = model.getSnapshot()
    expect(loaded.status === "ready" && loaded.messages.length).toBe(80)
    read.mockClear()
    model.refresh()
    await settled()
    expect(read.mock.calls.map(([before]) => before)).toEqual([undefined, "p_050"])
    const refreshed = model.getSnapshot()
    expect(refreshed.status === "ready" && refreshed.pages).toBe(2)
  })

  it("keeps the shown messages when a later read fails, and drops a cancelled read", async () => {
    let fail = false
    const read = pages(10)
    const model = createGroupMessages(async (before) => {
      if (fail) throw new Error("gone")
      return read(before)
    })
    model.refresh()
    model.cancel()
    await settled()
    expect(model.getSnapshot().status).toBe("loading")
    model.refresh()
    await settled()
    fail = true
    model.refresh()
    await settled()
    const state = model.getSnapshot()
    expect(state.status === "ready" && [state.messages.length, state.failure]).toEqual([10, "gone"])
    const failing = createGroupMessages(async () => {
      throw new Error("no")
    })
    failing.refresh()
    await settled()
    expect(failing.getSnapshot()).toEqual({ status: "failed", message: "no" })
  })
})

function handleOf<T>(items: readonly T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items
      await new Promise(() => {})
    },
    dispose() {},
  }
}

describe("the groups feed", () => {
  it("follows the snapshot and turns a refusal into a GroupsError with the Host's message", async () => {
    const join = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Bot kiri is already in group "Ops"' },
    }))
    const messages = vi.fn(async () => ({ ok: true as const, value: { messages: [] } }))
    const remote = {
      botGroups: { watch: () => handleOf([SNAPSHOT]), join, messages },
    } as unknown as BotCoreRemote
    const mount: Promise<RemoteMount> = Promise.resolve({ status: "mounted", remote })
    const feed = createGroupsFeed({ mount, generation: createStore<object | undefined>({}) })
    const off = feed.subscribe(() => {})
    await settled()
    await settled()
    expect(feed.getSnapshot()).toEqual({ status: "ready", snapshot: SNAPSHOT })
    const refused = await feed.join("g1", "kiri", { role: "", from: "g3" }).catch((cause) => cause)
    expect(refused).toBeInstanceOf(GroupsError)
    expect(refused.failure).toEqual({
      kind: "refused",
      message: 'Bot kiri is already in group "Ops"',
    })
    expect(join).toHaveBeenCalledWith("g1", "kiri", { role: "", from: "g3" })
    await feed.messages("g1", undefined)
    expect(messages).toHaveBeenCalledWith("g1", undefined)
    off()
  })

  it("fails with the mount's error when the Remote did not mount", async () => {
    const feed = createGroupsFeed({
      mount: Promise.resolve({ status: "failed", error: "no remote" }),
      generation: createStore<object | undefined>({}),
    })
    const off = feed.subscribe(() => {})
    await settled()
    expect(feed.getSnapshot()).toEqual({
      status: "failed",
      failure: { kind: "mount", message: "no remote" },
    })
    off()
  })
})

describe("the Groups section", () => {
  const render = (state: GroupsState, detail: string | null = null) =>
    renderToStaticMarkup(
      createElement(GroupsSection, {
        ...sectionProps(detail),
        groups: feedOf(state),
        bots: value(READY_BOTS),
      }),
    )

  it("shows each group with its name, purpose, members, add, pause, messages and delete rows, then a new group row", () => {
    const html = render({
      status: "ready",
      snapshot: {
        groups: [
          { ...research, purpose: "Papers", activity: { messages: 3, queued: 1, lastSentAt: 9 } },
          { ...ops, paused: { reason: "limit", at: 5, detail: "group" } },
        ],
      },
    })
    expect(html).toContain('data-dshb-group="g1"')
    expect(html).toContain('data-dshb-group-name="g1"')
    expect(html).toMatch(/data-dshb-group-purpose="g1"[^>]*>Papers</)
    expect(html).toContain('data-dshb-group-member="nova"')
    expect(html).toContain("drafts")
    expect(html).toContain("groups.role.none")
    expect(html).toContain('data-dshb-group-add="g1"')
    expect(html).toContain("groups.add.inGroup(Ops)")
    expect(html).toContain("groups.messages.count.other(3)")
    expect(html).toMatch(
      /data-dshb-group-pause="g2".*groups\.limit\.group.*data-tone="danger".*groups\.paused\.limit.*aria-checked="false"/,
    )
    expect(html).toMatch(/data-dshb-group-pause="g1".*?aria-checked="true"/)
    expect(html).toMatch(/data-tone="danger"[^>]*data-dshb-group-delete="g1"/)
    expect(html).toContain("data-dshb-group-new")
    expect(html.indexOf("data-dshb-group-new")).toBeGreaterThan(
      html.indexOf('data-dshb-group="g2"'),
    )
  })

  it("shows loading and the reason it is unavailable", () => {
    expect(render({ status: "loading" })).toContain("groups.loading")
    expect(
      render({ status: "failed", failure: { kind: "refused", message: "only the owner" } }),
    ).toContain("groups.unavailable(only the owner)")
  })

  it("opens a group's messages page from its detail", () => {
    const html = render({ status: "ready", snapshot: SNAPSHOT }, messagesDetail("g1"))
    expect(html).toContain('data-dshb-group-messages-page="g1"')
    expect(html).toContain("groups.messages.title(Research)")
    expect(html).not.toContain("data-dshb-group-new")
  })
})

describe("the messages page", () => {
  it("starts by loading the group's newest page", () => {
    const messages = vi.fn(async () => ({ messages: [] }))
    const html = renderToStaticMarkup(
      createElement(GroupMessagesPage, {
        t,
        group: research,
        bots: BOTS.bots,
        groups: { messages },
      }),
    )
    expect(html).toContain("groups.messages.loading")
  })
})

describe("a bot's group row", () => {
  it("shows the group and role, none, or why it cannot", () => {
    const ready: GroupsState = { status: "ready", snapshot: SNAPSHOT }
    expect(membershipText(t, ready, "nova").meta).toBe("Research · drafts")
    expect(membershipText(t, ready, "pico").meta).toBe("Research · groups.role.none")
    expect(membershipText(t, ready, "solo").meta).toBe("groups.membership.none")
    expect(
      membershipText(
        t,
        { status: "failed", failure: { kind: "connection", message: "x" } },
        "nova",
      ),
    ).toEqual({ meta: "groups.unavailable(x)", tone: "danger" })
    const html = renderToStaticMarkup(
      createElement(MembershipRow, { t, botId: "nova", groups: value(ready), openGroups() {} }),
    )
    expect(html).toContain("data-dshb-general-group-open")
    expect(html).toContain("groups.membership.open")
  })
})

describe("group texts", () => {
  it("have Japanese for every English key and are in the dictionary", () => {
    expect(Object.keys(GROUPS_JA).sort()).toEqual(Object.keys(GROUPS_EN).sort())
    for (const key of Object.keys(GROUPS_EN)) expect(en[key]).toBeDefined()
  })
})
