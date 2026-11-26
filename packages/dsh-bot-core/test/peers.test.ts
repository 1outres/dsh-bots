import { describe, expect, it } from "vitest"
import type { PeerGroupRecord, PeerMemberRecord, PeerMessageRecord } from "../src/host/peers/domain"
import {
  createPeerGroups,
  groupNameKey,
  type PeerBot,
  type PeerWithdrawn,
} from "../src/host/peers/groups"
import { createPeerPanel } from "../src/host/peers/panel"
import { createPeerStore } from "../src/host/peers/store"
import {
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_PURPOSE_LENGTH,
  MAX_MEMBER_ROLE_LENGTH,
  PEER_MESSAGE_PAGE,
  parseGroupChange,
  parseGroupInput,
  parseGroupJoin,
  parseMemberRole,
} from "../src/shared/peers"
import { memoryTable } from "./channels-support"

const OWNER = { kind: "owner" }

function setup(options: { kept?: number } = {}) {
  const tables = {
    peerGroups: memoryTable<PeerGroupRecord>(),
    peerMembers: memoryTable<PeerMemberRecord>(),
    peerMessages: memoryTable<PeerMessageRecord>(),
  }
  const store = createPeerStore({
    ...tables,
    keptMessages: options.kept ?? 500,
  })
  const bots = new Map<string, PeerBot>([
    ["nova", { state: "listed", name: "Nova" }],
    ["pico", { state: "listed", name: "Pico" }],
    ["kiri", { state: "listed", name: "Kiri" }],
    ["egg", { state: "creating", name: "Egg" }],
  ])
  let clock = 1_000
  let ids = 0
  const groups = createPeerGroups({
    store,
    bot: (botId) => bots.get(botId) ?? { state: "missing" },
    newId: () => `g${++ids}`,
    now: () => clock++,
  })
  const withdrawn: PeerWithdrawn[][] = []
  groups.onWithdrawn((list) => withdrawn.push([...list]))
  const panel = createPeerPanel({ groups })
  const message = (
    messageId: string,
    record: Partial<PeerMessageRecord> & Pick<PeerMessageRecord, "groupId" | "from" | "to">,
  ) =>
    store.change(() => ({
      writes: [
        {
          kind: "put-message",
          messageId,
          record: {
            threadId: messageId,
            expectsReply: true,
            depth: 0,
            text: "hello",
            sentAt: clock++,
            state: "queued",
            ...record,
          },
        },
      ],
      result: undefined,
    }))
  return { tables, store, groups, panel, bots, withdrawn, message }
}

describe("parsing group input", () => {
  it("trims a name and refuses an empty, long or multi-line one", () => {
    expect(parseGroupInput({ name: "  Research ", purpose: "" })).toEqual({
      name: "Research",
      purpose: "",
    })
    expect(() => parseGroupInput({ name: "  ", purpose: "" })).toThrow("the group name is empty")
    expect(
      parseGroupInput({ name: "あ".repeat(MAX_GROUP_NAME_LENGTH), purpose: "" }).name,
    ).toHaveLength(MAX_GROUP_NAME_LENGTH)
    expect(() =>
      parseGroupInput({ name: "a".repeat(MAX_GROUP_NAME_LENGTH + 1), purpose: "" }),
    ).toThrow("longer than 40")
    expect(() => parseGroupInput({ name: "Re\nsearch", purpose: "" })).toThrow("single line")
    expect(() => parseGroupInput({ name: "Re\u0007search", purpose: "" })).toThrow(
      "control or format",
    )
    expect(() => parseGroupInput({ name: "Re\u202esearch", purpose: "" })).toThrow(
      "control or format",
    )
  })

  it("keeps the newlines of a purpose and refuses other control characters", () => {
    expect(parseGroupInput({ name: "R", purpose: " line one\nline two " }).purpose).toBe(
      "line one\nline two",
    )
    expect(() => parseGroupInput({ name: "R", purpose: "a\tb" })).toThrow("control or format")
    expect(() =>
      parseGroupInput({ name: "R", purpose: "a".repeat(MAX_GROUP_PURPOSE_LENGTH + 1) }),
    ).toThrow("longer than 500")
  })

  it("refuses a missing field, an unknown field and something that is not an object", () => {
    expect(() => parseGroupInput({ name: "R" })).toThrow("the group purpose must be a string")
    expect(() => parseGroupInput({ name: "R", purpose: "", extra: 1 })).toThrow(
      "unknown fields: extra",
    )
    expect(() => parseGroupInput(["R"])).toThrow("must be an object")
    expect(() => parseGroupChange({})).toThrow("needs a name or a purpose")
    expect(parseGroupChange({ purpose: "x" })).toEqual({ purpose: "x" })
  })

  it("takes a one-line role of up to 200 characters and an optional from", () => {
    expect(parseMemberRole("  drafts ")).toBe("drafts")
    expect(parseMemberRole("")).toBe("")
    expect(() => parseMemberRole("a".repeat(MAX_MEMBER_ROLE_LENGTH + 1))).toThrow("longer than 200")
    expect(() => parseMemberRole("a\nb")).toThrow("single line")
    expect(parseGroupJoin({ role: "r", from: "g1" })).toEqual({ role: "r", from: "g1" })
    expect(() => parseGroupJoin({ role: "r", from: "" })).toThrow("a group id must be a string")
  })
})

describe("group names", () => {
  it("compares names as their header form, ignoring case", async () => {
    const { groups } = setup()
    expect(groupNameKey("Re(search)")).toBe("research")
    await groups.create({ name: "Research", purpose: "" })
    await expect(groups.create({ name: "research", purpose: "" })).rejects.toThrow(
      'a group named "Research" already exists',
    )
    await expect(groups.create({ name: "[Ｒｅｓｅａｒｃｈ]", purpose: "" })).rejects.toThrow(
      "already exists",
    )
    await expect(groups.create({ name: "()", purpose: "" })).rejects.toThrow(
      "needs a character other than",
    )
  })

  it("lets a group keep its own name and refuses another group's on a change", async () => {
    const { groups, panel } = setup()
    const research = await groups.create({ name: "Research", purpose: "" })
    await groups.create({ name: "Writing", purpose: "" })
    await expect(groups.update(research, { name: "RESEARCH", purpose: "papers" })).resolves.toBe(
      research,
    )
    expect(panel.snapshot(OWNER).groups[0]).toMatchObject({ name: "RESEARCH", purpose: "papers" })
    await expect(groups.update(research, { name: "writing" })).rejects.toThrow(
      'a group named "Writing" already exists',
    )
  })
})

describe("one group per bot", () => {
  it("lets a bot join one group and refuses a second without from", async () => {
    const { groups, panel } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    await groups.join(a, "nova", { role: "drafts" })
    await expect(groups.join(b, "nova", { role: "" })).rejects.toThrow(
      'Nova is already in group "A"',
    )
    await expect(groups.join(a, "nova", { role: "" })).rejects.toThrow(
      'Nova is already in group "A"',
    )
    expect(panel.snapshot(OWNER).groups.map((group) => group.members.map((m) => m.botId))).toEqual([
      ["nova"],
      [],
    ])
  })

  it("moves a bot only from its current group, in one write", async () => {
    const { groups, tables } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    const c = await groups.create({ name: "C", purpose: "" })
    await groups.join(a, "nova", { role: "" })
    await expect(groups.join(b, "nova", { role: "", from: c })).rejects.toThrow(
      'Nova is not in group "C"',
    )
    await expect(groups.join(b, "pico", { role: "", from: a })).rejects.toThrow(
      'Pico is not in group "A"',
    )
    const writes: string[] = []
    const put = tables.peerMembers.put
    tables.peerMembers.put = async (key, value) => {
      writes.push(key)
      await put(key, value)
    }
    await groups.join(b, "nova", { role: "moved", from: a })
    expect(writes).toEqual(["nova"])
    expect(groups.membership("nova")).toMatchObject({ groupId: b, member: { role: "moved" } })
  })

  it("serializes concurrent joins so a bot never ends up in two groups", async () => {
    const { groups } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    const results = await Promise.allSettled([
      groups.join(a, "nova", { role: "" }),
      groups.join(b, "nova", { role: "" }),
    ])
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(groups.membership("nova")?.groupId).toBe(a)
  })

  it("refuses a bot that is being created or does not exist", async () => {
    const { groups } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    await expect(groups.join(a, "egg", { role: "" })).rejects.toThrow(
      'bot "Egg" is still being created',
    )
    await expect(groups.join(a, "ghost", { role: "" })).rejects.toThrow('no bot "ghost"')
    await expect(groups.join("nope", "nova", { role: "" })).rejects.toThrow('no group "nope"')
  })
})

describe("members and pauses", () => {
  it("answers who shares a group, and sets a member's role", async () => {
    const { groups } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    await groups.join(a, "nova", { role: "" })
    await groups.join(a, "pico", { role: "proofreading" })
    await groups.join(b, "kiri", { role: "" })
    expect(groups.sharedGroup("nova", "pico")).toBe(a)
    expect(groups.sharedGroup("nova", "kiri")).toBeUndefined()
    expect(groups.sharedGroup("nova", "nova")).toBeUndefined()
    expect(groups.membership("nova")?.peers.map((peer) => peer.botId)).toEqual(["pico"])
    await groups.setRole("nova", "drafts")
    expect(groups.membership("nova")?.member.role).toBe("drafts")
    await expect(groups.setRole("egg", "x")).rejects.toThrow("Egg is in no group")
    await groups.leave("pico")
    expect(groups.membership("pico")).toBeUndefined()
    await expect(groups.leave("pico")).rejects.toThrow("Pico is in no group")
  })

  it("pauses for the owner or a limit, keeps the first pause and resumes both", async () => {
    const { groups, panel } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    await expect(groups.pauseForLimit(a, "group")).resolves.toBe(true)
    await expect(groups.pauseForLimit(a, "group")).resolves.toBe(false)
    await groups.setPaused(a, true)
    expect(panel.snapshot(OWNER).groups[0]?.paused).toMatchObject({
      reason: "limit",
      detail: "group",
    })
    await groups.setPaused(a, false)
    expect(panel.snapshot(OWNER).groups[0]?.paused).toBeUndefined()
    await groups.setPaused(a, true)
    expect(panel.snapshot(OWNER).groups[0]?.paused).toMatchObject({ reason: "owner" })
  })
})

describe("withdrawing and forgetting", () => {
  it("withdraws a leaving bot's undelivered messages and keeps the delivered ones", async () => {
    const { groups, store, withdrawn, message } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    for (const bot of ["nova", "pico", "kiri"]) await groups.join(a, bot, { role: "" })
    await message("p_1", { groupId: a, from: "nova", to: "pico" })
    await message("p_2", { groupId: a, from: "kiri", to: "nova" })
    await message("p_3", { groupId: a, from: "pico", to: "kiri" })
    await message("p_4", { groupId: a, from: "nova", to: "kiri", state: "delivered" })
    await groups.join(b, "nova", { role: "", from: a })
    expect(withdrawn).toEqual([
      [
        {
          messageId: "p_1",
          message: expect.objectContaining({ withdrawal: "left-group" }),
          groupName: "A",
        },
        {
          messageId: "p_2",
          message: expect.objectContaining({ withdrawal: "left-group" }),
          groupName: "A",
        },
      ],
    ])
    const states = Object.fromEntries(
      [...store.state().messages].map(([id, record]) => [id, record.state]),
    )
    expect(states).toEqual({ p_1: "withdrawn", p_2: "withdrawn", p_3: "queued", p_4: "delivered" })
  })

  it("deletes a group with its members and messages and reports the undelivered ones", async () => {
    const { groups, tables, withdrawn, message } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    await groups.join(a, "nova", { role: "" })
    await groups.join(a, "pico", { role: "" })
    await groups.join(b, "kiri", { role: "" })
    await message("p_1", { groupId: a, from: "nova", to: "pico" })
    await message("p_2", { groupId: a, from: "pico", to: "nova", state: "delivered" })
    await groups.deleteGroup(a)
    expect(withdrawn).toEqual([
      [
        {
          messageId: "p_1",
          message: expect.objectContaining({ withdrawal: "group-deleted" }),
          groupName: "A",
        },
      ],
    ])
    expect([...tables.peerGroups.rows.keys()]).toEqual([b])
    expect([...tables.peerMembers.rows.keys()]).toEqual(["kiri"])
    expect(tables.peerMessages.rows.size).toBe(0)
  })

  it("forgets a deleted bot's membership and messages", async () => {
    const { groups, tables, withdrawn, message } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    for (const bot of ["nova", "pico", "kiri"]) await groups.join(a, bot, { role: "" })
    await message("p_1", { groupId: a, from: "pico", to: "nova" })
    await message("p_2", { groupId: a, from: "nova", to: "kiri", state: "delivered" })
    await message("p_3", { groupId: a, from: "pico", to: "kiri" })
    await groups.forgetBots((botId) => botId !== "nova")
    expect(withdrawn).toEqual([
      [
        {
          messageId: "p_1",
          message: expect.objectContaining({ withdrawal: "bot-deleted" }),
          groupName: "A",
        },
      ],
    ])
    expect([...tables.peerMembers.rows.keys()].sort()).toEqual(["kiri", "pico"])
    expect([...tables.peerMessages.rows.keys()]).toEqual(["p_3"])
  })
})

describe("the peer store", () => {
  it("keeps each group's newest messages only", async () => {
    const { groups, tables, message } = setup({ kept: 2 })
    const a = await groups.create({ name: "A", purpose: "" })
    const b = await groups.create({ name: "B", purpose: "" })
    await message("p_1", { groupId: a, from: "nova", to: "pico" })
    await message("p_2", { groupId: a, from: "nova", to: "pico" })
    await message("p_3", { groupId: b, from: "nova", to: "pico" })
    await message("p_4", { groupId: a, from: "nova", to: "pico" })
    expect([...tables.peerMessages.rows.keys()].sort()).toEqual(["p_2", "p_3", "p_4"])
  })

  it("refuses a member or a message of a group that does not exist", async () => {
    const { store, message } = setup()
    await expect(
      store.change(() => ({
        writes: [
          { kind: "put-member", botId: "nova", record: { groupId: "x", role: "", joinedAt: 1 } },
        ],
        result: undefined,
      })),
    ).rejects.toThrow("does not exist")
    await expect(message("p_1", { groupId: "x", from: "nova", to: "pico" })).rejects.toThrow(
      "does not exist",
    )
  })

  it("repairs members and messages left without their group", async () => {
    const { tables, store } = setup()
    tables.peerMembers.rows.set("nova", { groupId: "gone", role: "", joinedAt: 1 })
    await store.repair()
    expect(tables.peerMembers.rows.size).toBe(0)
  })

  it("tells its subscribers only when something was written", async () => {
    const { groups, store } = setup()
    let told = 0
    store.subscribe(() => told++)
    const a = await groups.create({ name: "A", purpose: "" })
    await groups.setPaused(a, false)
    expect(told).toBe(1)
  })
})

describe("the groups panel", () => {
  it("serves only the owner of this DSH, an absent caller included", async () => {
    const { panel } = setup()
    const refusal = "only the owner of this DSH manages bot groups"
    expect(() => panel.snapshot(undefined)).toThrow(refusal)
    expect(() => panel.snapshot({ kind: "guest" })).toThrow(refusal)
    expect(() => panel.messages(undefined, "g1", undefined, undefined)).toThrow(refusal)
    await expect(panel.create({ kind: "guest" }, { name: "A", purpose: "" })).rejects.toThrow(
      refusal,
    )
    await expect(panel.leave(undefined, "nova")).rejects.toThrow(refusal)
  })

  it("checks the input before it reaches the rules", async () => {
    const { panel } = setup()
    const group = await panel.create(OWNER, { name: " A ", purpose: "" })
    expect(group).toEqual({ id: "g1", name: "A", purpose: "", members: [], createdAt: 1000 })
    await expect(panel.join(OWNER, group.id, "nova", { role: 3 })).rejects.toThrow(
      "the role must be a string",
    )
    await expect(panel.setPaused(OWNER, group.id, "yes")).rejects.toThrow("true or false")
    const joined = await panel.join(OWNER, group.id, "nova", { role: "drafts" })
    expect(joined.members).toEqual([{ botId: "nova", role: "drafts", joinedAt: 1001 }])
    expect(await panel.deleteGroup(OWNER, group.id)).toEqual({ groups: [] })
  })

  it("pages a group's messages from the newest, oldest first within a page", async () => {
    const { groups, panel, message } = setup()
    const a = await groups.create({ name: "A", purpose: "" })
    const total = PEER_MESSAGE_PAGE + 5
    for (let index = 0; index < total; index++) {
      await message(`p_${String(index).padStart(2, "0")}`, { groupId: a, from: "nova", to: "pico" })
    }
    const newest = panel.messages(OWNER, a, undefined, undefined)
    expect(newest.messages).toHaveLength(PEER_MESSAGE_PAGE)
    expect(newest.messages[0]?.id).toBe("p_05")
    expect(newest.messages.at(-1)?.id).toBe("p_44")
    expect(newest.earlier).toBe("p_05")
    const older = panel.messages(OWNER, a, newest.earlier, undefined)
    expect(older.messages.map((item) => item.id)).toEqual(["p_00", "p_01", "p_02", "p_03", "p_04"])
    expect(older.earlier).toBeUndefined()
    expect(() => panel.messages(OWNER, a, "p_zz", undefined)).toThrow(
      'no message "p_zz" in group "A"',
    )
    expect(panel.messages(OWNER, a, "p_00", undefined)).toEqual({ messages: [] })
  })
})
