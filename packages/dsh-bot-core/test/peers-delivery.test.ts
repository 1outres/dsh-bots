import { describe, expect, it } from "vitest"
import type { NoticeWithdrawal } from "../src/host/notices/delivery"
import type { NoticeContent, PeerNoticeOrigin } from "../src/host/notices/outbox"
import { createPeerDelivery } from "../src/host/peers/delivery"
import type { PeerGroupRecord, PeerMemberRecord, PeerMessageRecord } from "../src/host/peers/domain"
import { createPeerGroups, type PeerBot } from "../src/host/peers/groups"
import { judgePeerSend, PEER_LIMITS, type PeerSendRequest } from "../src/host/peers/limits"
import { peerMessageNotice, undeliveredNotice } from "../src/host/peers/notice"
import { newThreadDepth, peerOriginOf } from "../src/host/peers/origin"
import { createPeerPairPauses } from "../src/host/peers/pair-pauses"
import { createPeerSend } from "../src/host/peers/send"
import { createPeerStore } from "../src/host/peers/store"
import type { PartyTurn } from "../src/host/turns/parties"
import { memoryTable } from "./channels-support"

const MINUTE = 60_000

interface Enqueued {
  readonly botId: string
  readonly topic: string
  readonly notice: NoticeContent
  readonly origin?: PeerNoticeOrigin
  readonly id: string
}

const turn = (inputs: PartyTurn["inputs"], peerMessages: string[] = []): PartyTurn => ({
  turn: 1,
  open: true,
  inputs,
  peerMessages,
})

async function setup() {
  const store = createPeerStore({
    peerGroups: memoryTable<PeerGroupRecord>(),
    peerMembers: memoryTable<PeerMemberRecord>(),
    peerMessages: memoryTable<PeerMessageRecord>(),
    keptMessages: 500,
  })
  const bots = new Map<string, PeerBot>([
    ["nova", { state: "listed", name: "Nova" }],
    ["pico", { state: "listed", name: "Pico" }],
    ["kiri", { state: "listed", name: "Kiri" }],
  ])
  const clock = { now: 1_000_000 }
  let ids = 0
  const groups = createPeerGroups({
    store,
    bot: (botId) => bots.get(botId) ?? { state: "missing" },
    newId: () => `g${++ids}`,
    now: () => clock.now,
  })
  const enqueued: Enqueued[] = []
  const withdrawals = new Map<string, NoticeWithdrawal>()
  const withdrawn: string[] = []
  const notices = {
    async enqueue(botId: string, topic: string, notice: NoticeContent, origin?: PeerNoticeOrigin) {
      const id = `n${enqueued.length + 1}`
      enqueued.push({ botId, topic, notice, ...(origin === undefined ? {} : { origin }), id })
      return { id }
    },
    async withdraw(noticeId: string) {
      withdrawn.push(noticeId)
      return withdrawals.get(noticeId) ?? "withdrawn"
    },
  }
  const timers: { at: number; work: () => void; cancelled: boolean }[] = []
  const stopped = new Set<string>()
  const turns = new Map<string, PartyTurn | undefined>([
    ["main-nova", turn(["owner"])],
    ["main-pico", turn(["owner"])],
    ["main-kiri", turn(["owner"])],
  ])
  const pairPauses = createPeerPairPauses({ now: () => clock.now })
  const name = (botId: string) => {
    const bot = bots.get(botId)
    if (bot?.state !== "listed") throw new Error(`no bot ${botId}`)
    return bot.name
  }
  const delivery = createPeerDelivery({
    groups,
    store,
    notices,
    exists: (botId) => bots.has(botId),
    botName: (botId) => {
      const bot = bots.get(botId)
      return bot?.state === "listed" ? bot.name : undefined
    },
    stopped: (botId) => stopped.has(botId),
    later(ms, work) {
      const timer = { at: clock.now + ms, work, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    now: () => clock.now,
    warn: () => {},
  })
  const send = createPeerSend({
    refusal: (_botId, _token, agentId) =>
      agentId.startsWith("main-") ? undefined : "peer_send works only in the bot's Main session",
    groups,
    store,
    pairPauses,
    turn: (agentId) => turns.get(agentId),
    botName: name,
    timezone: () => "UTC",
    stopped: (botId) => stopped.has(botId),
    shield: async (_botId, text) => text.replaceAll("hunter2", "[secret]"),
    notices,
    track: (messageId) => delivery.track(messageId),
    newId: () => `${++ids}`.padStart(4, "0"),
    now: () => clock.now,
    warn: () => {},
  })
  const group = await groups.create({ name: "Research", purpose: "" })
  for (const bot of ["nova", "pico", "kiri"]) await groups.join(group, bot, { role: "" })
  const call = (agentId: string, botId: string, args: object) =>
    send.call(botId, "t", { agentId, args })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const advance = async (ms: number) => {
    clock.now += ms
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.at <= clock.now)) {
      timer.cancelled = true
      timer.work()
    }
    await settle()
  }
  return {
    store,
    groups,
    group,
    bots,
    clock,
    enqueued,
    withdrawals,
    withdrawn,
    stopped,
    turns,
    pairPauses,
    delivery,
    send,
    call,
    settle,
    advance,
  }
}

describe("peer_send", () => {
  it("queues a shielded message for the peer's Main and answers right away", async () => {
    const h = await setup()
    const result = await h.call("main-nova", "nova", {
      to: "pico",
      message: "Could you check hunter2?\nThanks.",
    })
    const [entry] = h.enqueued
    const id = (result.data as { sent: string }).sent
    expect(id).toMatch(/^p_/)
    expect(result.text).toBe(
      `Sent ${id} to Pico (thread ${id}). It reaches Pico's Main session after its current turn; a reply, if any, comes back here as a [peer] notice. Do not wait for it in this turn.`,
    )
    expect(entry?.botId).toBe("pico")
    expect(entry?.topic).toBe("peer")
    expect(entry?.origin).toEqual({ peerMessages: [id] })
    expect(entry?.notice.text).toBe(
      `[peer] Nova (bot nova, group "Research") sent you message ${id} (thread ${id}). A reply is expected.\nCould you check [secret]?\nThanks.`,
    )
    expect(entry?.notice.summary).toBe("Message from Nova")
    expect(h.store.state().messages.get(id)).toMatchObject({
      state: "queued",
      depth: 0,
      expectsReply: true,
      noticeId: entry?.id,
    })
  })

  it("says when the peer's machine is stopped", async () => {
    const h = await setup()
    h.stopped.add("pico")
    const result = await h.call("main-nova", "nova", { to: "pico", message: "hi" })
    expect(result.text).toContain(
      "Pico's machine is stopped now: the message waits until it is back, for up to 24 hours.",
    )
  })

  it("refuses outside the Main session, outside the group and to itself, without a record", async () => {
    const h = await setup()
    await expect(h.call("web-nova", "nova", { to: "pico", message: "hi" })).rejects.toThrow(
      "only in the bot's Main session",
    )
    await expect(h.call("main-nova", "nova", { to: "nova", message: "hi" })).rejects.toThrow(
      "your own bot id",
    )
    await expect(h.call("main-nova", "nova", { to: "zed", message: "hi" })).rejects.toThrow(
      "is not a bot in your group",
    )
    await expect(
      h.call("main-nova", "nova", {
        to: "pico",
        message: "x".repeat(PEER_LIMITS.messageLength + 1),
      }),
    ).rejects.toThrow("over the limit")
    await h.groups.leave("kiri")
    await expect(h.call("main-kiri", "kiri", { to: "pico", message: "hi" })).rejects.toThrow(
      "you are in no group",
    )
    expect(h.store.state().messages.size).toBe(0)
  })

  it("replies only to a delivered message the peer sent, in its thread, quoting it", async () => {
    const h = await setup()
    const sent = await h.call("main-nova", "nova", { to: "pico", message: "What is 2+2?" })
    const id = (sent.data as { sent: string }).sent
    await expect(
      h.call("main-pico", "pico", { to: "nova", message: "4", reply_to: id }),
    ).rejects.toThrow("is not a message Nova sent you")
    h.delivery.delivered({ topic: "peer", peerMessages: [id] })
    await h.settle()
    h.turns.set("main-pico", turn(["peer"], [id]))
    const reply = await h.call("main-pico", "pico", { to: "nova", message: "4", reply_to: id })
    const replyId = (reply.data as { sent: string }).sent
    expect(h.store.state().messages.get(replyId)).toMatchObject({
      threadId: id,
      replyTo: id,
      expectsReply: false,
      depth: 0,
    })
    expect(h.enqueued.at(-1)?.notice.text).toBe(
      `[peer] Pico (bot pico, group "Research") replied to your message ${id} with ${replyId} (thread ${id}). No reply is needed.\n> You wrote: What is 2+2?\n4`,
    )
    expect(h.enqueued.at(-1)?.notice.summary).toBe("Reply from Pico")
  })

  it("carries the depth of a peer's request and refuses a third level or an unknown turn", async () => {
    const h = await setup()
    const first = await h.call("main-nova", "nova", { to: "pico", message: "Ask around." })
    const firstId = (first.data as { sent: string }).sent
    h.delivery.delivered({ topic: "peer", peerMessages: [firstId] })
    await h.settle()
    h.turns.set("main-pico", turn(["peer"], [firstId]))
    const second = await h.call("main-pico", "pico", { to: "kiri", message: "Do you know?" })
    const secondId = (second.data as { sent: string }).sent
    expect(h.store.state().messages.get(secondId)?.depth).toBe(1)
    h.turns.set("main-kiri", turn(["peer"], [secondId]))
    await expect(h.call("main-kiri", "kiri", { to: "nova", message: "And you?" })).rejects.toThrow(
      "cannot pull in another bot",
    )
    h.turns.set("main-kiri", undefined)
    await expect(h.call("main-kiri", "kiri", { to: "nova", message: "And you?" })).rejects.toThrow(
      "cannot tell which peer conversation",
    )
    const refused = [...h.store.state().messages.values()].filter(
      (message) => message.state === "refused",
    )
    expect(refused.map((message) => message.refusal)).toEqual(["depth", "depth"])
  })

  it("pauses a pair that talks too much and tells both Mains", async () => {
    const h = await setup()
    for (let index = 0; index < PEER_LIMITS.pair.count; index += 1) {
      await h.call("main-nova", "nova", { to: "pico", message: `m${index}` })
    }
    await expect(h.call("main-nova", "nova", { to: "pico", message: "again" })).rejects.toThrow(
      "exchanged 8 messages in 10 minutes",
    )
    await h.settle()
    expect(h.pairPauses.until("pico", "nova")).toBe(h.clock.now + PEER_LIMITS.pair.pauseMs)
    const status = h.enqueued.filter((entry) => entry.topic === "peer-status")
    expect(status.map((entry) => entry.botId).sort()).toEqual(["nova", "pico"])
    expect(status.find((entry) => entry.botId === "nova")?.notice.text).toMatch(
      /^\[peer\] Messages between you and Pico are paused until \d\d:\d\d \(8 messages in 10 minutes\)/,
    )
    await expect(h.call("main-pico", "pico", { to: "nova", message: "x" })).rejects.toThrow(
      "are paused until",
    )
    await h.call("main-nova", "nova", { to: "kiri", message: "still fine" })
  })

  it("pauses the whole group past its limit until the owner resumes it", async () => {
    const h = await setup()
    await h.store.change(() => ({
      writes: Array.from({ length: PEER_LIMITS.group.count }, (_, index) => ({
        kind: "put-message" as const,
        messageId: `p_old${index}`,
        record: {
          groupId: h.group,
          from: `x${index}`,
          to: `y${index}`,
          threadId: `p_old${index}`,
          expectsReply: false,
          depth: 0,
          text: "x",
          sentAt: h.clock.now - MINUTE,
          state: "delivered" as const,
        },
      })),
      result: undefined,
    }))
    await expect(h.call("main-nova", "nova", { to: "pico", message: "more" })).rejects.toThrow(
      /had 30 messages in 10 minutes/,
    )
    await h.settle()
    expect(h.store.state().groups.get(h.group)?.paused).toMatchObject({
      reason: "limit",
      detail: "group",
    })
    const status = h.enqueued.filter((entry) => entry.topic === "peer-status")
    expect(status.map((entry) => entry.botId).sort()).toEqual(["kiri", "nova", "pico"])
    await expect(h.call("main-pico", "pico", { to: "kiri", message: "x" })).rejects.toThrow(
      "until your owner resumes them",
    )
  })
})

describe("judgePeerSend", () => {
  const base: PeerSendRequest = {
    groupId: "g",
    from: "a",
    to: "b",
    threadId: "p_t",
    replying: true,
    depth: 0,
    groupPause: undefined,
    pairPausedUntil: undefined,
  }
  const message = (overrides: Partial<PeerMessageRecord>): PeerMessageRecord => ({
    groupId: "g",
    from: "a",
    to: "b",
    threadId: "p_t",
    expectsReply: true,
    depth: 0,
    text: "x",
    sentAt: 0,
    state: "delivered",
    ...overrides,
  })

  it("refuses a full thread, counting both ways but not refusals", () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      message({ from: index % 2 === 0 ? "a" : "b", to: index % 2 === 0 ? "b" : "a" }),
    )
    expect(judgePeerSend(history, 100 * MINUTE, base)).toEqual({
      kind: "refused",
      reason: { refusal: "thread", count: 12 },
    })
    expect(
      judgePeerSend(history.slice(1).concat(message({ state: "refused" })), 100 * MINUTE, base),
    ).toEqual({ kind: "send" })
  })

  it("refuses a sender over 40 an hour until the oldest leaves the window", () => {
    const history = Array.from({ length: 40 }, (_, index) =>
      message({ to: `b${index}`, threadId: `t${index}`, sentAt: index * MINUTE }),
    )
    expect(judgePeerSend(history, 50 * MINUTE, { ...base, to: "c" })).toEqual({
      kind: "refused",
      reason: { refusal: "sender", count: 40, until: 60 * MINUTE },
    })
    expect(judgePeerSend(history, 61 * MINUTE, { ...base, to: "c" })).toEqual({ kind: "send" })
  })

  it("refuses a paused group first and a new thread deeper than 1", () => {
    expect(judgePeerSend([], 0, { ...base, groupPause: { reason: "owner", at: 0 } }).kind).toBe(
      "refused",
    )
    expect(judgePeerSend([], 0, { ...base, replying: false, depth: 2 })).toEqual({
      kind: "refused",
      reason: { refusal: "depth", depth: 2 },
    })
    expect(judgePeerSend([], 0, { ...base, replying: true, depth: 2 })).toEqual({ kind: "send" })
  })
})

describe("the depth of a new thread", () => {
  it("is 0 outside a peer's turn, one more than the deepest peer message, unknown otherwise", async () => {
    const h = await setup()
    await h.store.change(() => ({
      writes: [
        {
          kind: "put-message",
          messageId: "p_a",
          record: {
            groupId: h.group,
            from: "pico",
            to: "nova",
            threadId: "p_a",
            expectsReply: true,
            depth: 1,
            text: "x",
            sentAt: 0,
            state: "delivered",
          },
        },
      ],
      result: undefined,
    }))
    const state = h.store.state()
    expect(newThreadDepth(state, peerOriginOf(state, turn(["owner", "system"])))).toBe(0)
    expect(newThreadDepth(state, peerOriginOf(state, turn(["peer"], ["p_a"])))).toBe(2)
    expect(newThreadDepth(state, peerOriginOf(state, turn(["peer"], [])))).toBeUndefined()
    expect(newThreadDepth(state, peerOriginOf(state, turn(["peer"], ["p_gone"])))).toBeUndefined()
    expect(newThreadDepth(state, peerOriginOf(state, undefined))).toBeUndefined()
    expect(peerOriginOf(state, turn(["peer"], ["p_a"]))?.from).toBe("pico")
  })
})

describe("delivery and withdrawal", () => {
  it("marks a message delivered when its notice is recorded", async () => {
    const h = await setup()
    const sent = await h.call("main-nova", "nova", { to: "pico", message: "hi" })
    const id = (sent.data as { sent: string }).sent
    h.delivery.delivered({ topic: "peer", peerMessages: [id] })
    await h.settle()
    expect(h.store.state().messages.get(id)?.state).toBe("delivered")
  })

  it("withdraws undelivered messages when a bot leaves and tells the senders who stay", async () => {
    const h = await setup()
    const toPico = (await h.call("main-nova", "nova", { to: "pico", message: "a" })).data as {
      sent: string
    }
    const fromPico = (await h.call("main-pico", "pico", { to: "kiri", message: "b" })).data as {
      sent: string
    }
    await h.groups.leave("pico")
    await h.settle()
    expect(h.withdrawn).toEqual(["n1", "n2"])
    const status = h.enqueued.filter((entry) => entry.topic === "peer-status")
    expect(status).toEqual([
      expect.objectContaining({
        botId: "nova",
        notice: {
          text: `[peer] Your message ${toPico.sent} to Pico was not delivered: Pico left the group "Research".`,
          summary: "Message to Pico not delivered",
        },
      }),
    ])
    expect(h.store.state().messages.get(fromPico.sent)?.state).toBe("withdrawn")
  })

  it("keeps a message that was already read and lists one notice per sender on a group deletion", async () => {
    const h = await setup()
    const one = (await h.call("main-nova", "nova", { to: "pico", message: "a" })).data as {
      sent: string
    }
    const two = (await h.call("main-nova", "nova", { to: "kiri", message: "b" })).data as {
      sent: string
    }
    await h.call("main-kiri", "kiri", { to: "pico", message: "c" })
    h.withdrawals.set("n3", "recorded")
    await h.groups.deleteGroup(h.group)
    await h.settle()
    const status = h.enqueued.filter((entry) => entry.topic === "peer-status")
    expect(status.map((entry) => entry.botId)).toEqual(["nova"])
    expect(status[0]?.notice.text).toBe(
      [
        "[peer] 2 of your messages were not delivered:",
        `- ${one.sent} to Pico: the group "Research" was deleted by your owner.`,
        `- ${two.sent} to Kiri: the group "Research" was deleted by your owner.`,
      ].join("\n"),
    )
  })

  it("expires a message after 24 hours and tells the sender", async () => {
    const h = await setup()
    h.stopped.add("pico")
    const sent = (await h.call("main-nova", "nova", { to: "pico", message: "a" })).data as {
      sent: string
    }
    await h.advance(PEER_LIMITS.deliveryMs)
    expect(h.store.state().messages.get(sent.sent)).toMatchObject({
      state: "expired",
      withdrawal: "expired",
    })
    expect(h.enqueued.at(-1)?.notice.text).toBe(
      `[peer] Your message ${sent.sent} to Pico was not delivered within 24 hours (Pico's machine stayed stopped), so it was withdrawn.`,
    )
  })

  it("schedules the expiry of queued messages at start", async () => {
    const h = await setup()
    await h.call("main-nova", "nova", { to: "pico", message: "a" })
    const again = createPeerDelivery({
      groups: h.groups,
      store: h.store,
      notices: { enqueue: async () => ({ id: "x" }), withdraw: async () => "withdrawn" },
      exists: () => true,
      botName: () => "Bot",
      stopped: () => false,
      later: (ms) => {
        expect(ms).toBe(PEER_LIMITS.deliveryMs)
        return () => {}
      },
      now: () => h.clock.now,
      warn: () => {},
    })
    again.start()
    again.dispose()
  })
})

describe("peer notice texts", () => {
  it("quotes at most 300 characters on one line", () => {
    const replied: PeerMessageRecord = {
      groupId: "g",
      from: "nova",
      to: "pico",
      threadId: "p_1",
      expectsReply: true,
      depth: 0,
      text: `line one\n${"y".repeat(400)}`,
      sentAt: 0,
      state: "delivered",
    }
    const notice = peerMessageNotice({
      messageId: "p_2",
      message: { ...replied, from: "pico", to: "nova", replyTo: "p_1", expectsReply: false },
      fromName: "Pi[co]",
      groupName: "Lab (A)",
      replied,
    })
    const [head, quote] = notice.text.split("\n")
    expect(head).toBe(
      '[peer] Pico (bot pico, group "Lab A") replied to your message p_1 with p_2 (thread p_1). No reply is needed.',
    )
    expect(quote).toBe(`> You wrote: line one ${"y".repeat(291)}…`)
  })

  it("says why a message was not delivered", () => {
    expect(
      undeliveredNotice([
        {
          messageId: "p_1",
          toName: "Nova",
          groupName: "R",
          withdrawal: "bot-deleted",
          stopped: false,
        },
      ]).text,
    ).toBe("[peer] Your message p_1 to Nova was not delivered: Nova was deleted by your owner.")
    expect(
      undeliveredNotice([
        { messageId: "p_1", toName: "Nova", groupName: "R", withdrawal: "expired", stopped: false },
      ]).text,
    ).toBe(
      "[peer] Your message p_1 to Nova was not delivered within 24 hours, so it was withdrawn.",
    )
  })
})
