import { describe, expect, it } from "vitest"
import type { ConnectorEvent } from "../src/connector-contract"
import { createSenderAnswers } from "../src/host/senders/answers"
import {
  SENDER_MIGRATION_KEY,
  type SenderInquiryRecord,
  type SenderMigrationRecord,
  type SenderPolicyRecord,
} from "../src/host/senders/domain"
import { createSenderPolicies, type SenderRelease } from "../src/host/senders/policies"
import { createSenderStore } from "../src/host/senders/store"
import {
  checkSenderMatch,
  coversFreemail,
  hiddenTally,
  isFreemailDomain,
  judgeSender,
  type SenderPolicy,
  type SenderRule,
  senderChoicesFor,
  senderHiddenNote,
  startingSenderPolicy,
} from "../src/shared/senders"
import { memoryTable } from "./channels-support"

const rule = (
  kind: "address" | "domain",
  value: string,
  verdict: "allow" | "deny",
): SenderRule => ({
  match: { kind, value },
  verdict,
  decidedAt: 1,
  origin: { kind: "web" },
})
const from = (address: string, verified = true) => ({
  kind: "external" as const,
  address,
  verified,
})

describe("judging a sender", () => {
  const policy = (unknown: SenderPolicy["unknown"], rules: SenderRule[] = []): SenderPolicy => ({
    unknown,
    rules,
  })

  it("lets the address beat the domain, and an exact domain beat a wildcard", () => {
    const rules = [
      rule("domain", "*.example.com", "deny"),
      rule("domain", "example.com", "allow"),
      rule("address", "boss@sub.example.com", "allow"),
      rule("domain", "*.sub.example.com", "allow"),
    ]
    const p = policy("deny", rules)
    expect(judgeSender(p, from("a@example.com"))).toEqual({ visible: true, basis: "rule" })
    expect(judgeSender(p, from("a@other.example.com"))).toMatchObject({
      visible: false,
      reason: "denied",
    })
    expect(judgeSender(p, from("BOSS@Sub.Example.com"))).toEqual({ visible: true, basis: "rule" })
    expect(judgeSender(p, from("x@deep.sub.example.com"))).toEqual({ visible: true, basis: "rule" })
  })

  it("matches a wildcard domain on the domain itself and its subdomains only", () => {
    const p = policy("deny", [rule("domain", "*.example.com", "allow")])
    expect(judgeSender(p, from("a@example.com")).visible).toBe(true)
    expect(judgeSender(p, from("a@x.y.example.com")).visible).toBe(true)
    expect(judgeSender(p, from("a@badexample.com")).visible).toBe(false)
    const exact = policy("deny", [rule("domain", "example.com", "allow")])
    expect(judgeSender(exact, from("a@sub.example.com")).visible).toBe(false)
  })

  it("never lets an allow rule pass an unverified sender, and never asks about one", () => {
    const allowed = [rule("address", "a@example.com", "allow")]
    expect(judgeSender(policy("ask", allowed), from("a@example.com", false))).toEqual({
      visible: false,
      reason: "unverified",
      inquire: false,
    })
    expect(judgeSender(policy("allow", allowed), from("a@example.com", false))).toEqual({
      visible: true,
      basis: "unknown",
    })
    expect(
      judgeSender(
        policy("allow", [rule("address", "a@example.com", "deny")]),
        from("a@example.com", false),
      ),
    ).toMatchObject({
      visible: false,
      reason: "denied",
    })
  })

  it("asks about a verified sender without a rule only when unknown senders are asked about", () => {
    expect(judgeSender(policy("ask"), from("a@example.com"))).toEqual({
      visible: false,
      reason: "unknown",
      inquire: true,
    })
    expect(judgeSender(policy("deny"), from("a@example.com"))).toEqual({
      visible: false,
      reason: "unknown",
      inquire: false,
    })
    expect(judgeSender(policy("allow"), from("a@example.com"))).toEqual({
      visible: true,
      basis: "unknown",
    })
  })

  it("always shows the account's own mail and hides an anonymous one unless unknown senders are allowed", () => {
    expect(judgeSender(policy("deny"), { kind: "self" })).toEqual({ visible: true, basis: "self" })
    expect(judgeSender(policy("ask"), { kind: "anonymous" })).toMatchObject({
      visible: false,
      reason: "unverified",
    })
    expect(judgeSender(policy("allow"), { kind: "anonymous" }).visible).toBe(true)
    expect(judgeSender(policy("ask"), from("not an address"))).toMatchObject({
      reason: "unverified",
    })
  })

  it("normalizes matches and refuses what is not an address or a domain", () => {
    expect(checkSenderMatch({ kind: "address", value: " Ann@Example.COM " })).toEqual({
      ok: true,
      match: { kind: "address", value: "ann@example.com" },
    })
    expect(checkSenderMatch({ kind: "domain", value: "*.Example.com" })).toEqual({
      ok: true,
      match: { kind: "domain", value: "*.example.com" },
    })
    expect(checkSenderMatch({ kind: "domain", value: "localhost" }).ok).toBe(false)
    expect(checkSenderMatch({ kind: "domain", value: "a@b.com" }).ok).toBe(false)
    expect(checkSenderMatch({ kind: "address", value: "ann" }).ok).toBe(false)
    expect(checkSenderMatch({ kind: "url", value: "x" }).ok).toBe(false)
  })

  it("knows free mail domains: no domain answer for them, and a warning for rules that cover them", () => {
    expect(isFreemailDomain("gmail.com")).toBe(true)
    expect(isFreemailDomain("gmx.de")).toBe(true)
    expect(isFreemailDomain("yahoo.co.jp")).toBe(true)
    expect(isFreemailDomain("example.com")).toBe(false)
    expect(senderChoicesFor("a@gmail.com")).toEqual([
      "allow-address",
      "deny-address",
      "deny-domain",
    ])
    expect(senderChoicesFor("a@example.com")).toHaveLength(4)
    expect(coversFreemail({ kind: "domain", value: "*.co.jp" })).toBe(true)
    expect(coversFreemail({ kind: "domain", value: "example.com" })).toBe(false)
  })

  it("tells how many messages it hid and why, never which", () => {
    expect(senderHiddenNote(hiddenTally([]))).toBeUndefined()
    expect(senderHiddenNote(hiddenTally(["unknown", "unknown", "denied"]))).toBe(
      "3 messages hidden by the sender policy (2 from senders not allowed yet, 1 denied). The account's owner can allow senders in the bot's settings to let you read them.",
    )
    expect(senderHiddenNote(hiddenTally(["unverified"]))).toBe(
      "1 message hidden by the sender policy (1 from senders that could not be verified).",
    )
  })
})

function sendersSetup() {
  let now = 1_000
  let ids = 0
  const tables = {
    senderPolicies: memoryTable<SenderPolicyRecord>(),
    senderInquiries: memoryTable<SenderInquiryRecord>(),
    senderMigrations: memoryTable<SenderMigrationRecord>(),
  }
  const store = createSenderStore({ ...tables, now: () => now })
  const released: SenderRelease[] = []
  const policies = createSenderPolicies({
    store,
    release: async (release) => {
      released.push(release)
    },
    account: (connectionId) => `${connectionId}@example.org`,
    connectorName: () => "Gmail",
    newId: () => `snd-${++ids}`,
    now: () => now,
    maxHeld: 2,
    closedRetentionMs: 1_000,
  })
  return {
    tables,
    store,
    policies,
    released,
    advance(ms: number) {
      now += ms
    },
  }
}

const mail = (key: string, address: string, verified = true): ConnectorEvent => ({
  key,
  kind: "gmail.message.received",
  occurredAt: 1,
  summary: `From: ${address}`,
  ref: { message_id: key },
  sender: { kind: "external", address, verified },
})

describe("the sender store", () => {
  it("allows unknown senders on the accounts that existed before, once, and asks on new ones", async () => {
    const { store, tables } = sendersSetup()
    await expect(store.start("conn-new", "connected")).rejects.toThrow("not migrated")
    await store.migrate(["conn-a", "conn-b"])
    expect(store.policy("conn-a")).toEqual(startingSenderPolicy("migrated"))
    expect(store.policy("conn-a")?.unknown).toBe("allow")
    expect(tables.senderMigrations.rows.get(SENDER_MIGRATION_KEY)?.connections).toEqual([
      "conn-a",
      "conn-b",
    ])
    await store.migrate(["conn-c"])
    expect(store.policy("conn-c")).toBeUndefined()
    await store.start("conn-c", "connected")
    expect(store.policy("conn-c")?.unknown).toBe("ask")
    await store.setUnknown("conn-a", "deny")
    await store.start("conn-a", "connected")
    expect(store.policy("conn-a")?.unknown).toBe("deny")
  })
})

describe("sender policies", () => {
  it("holds mail from a new verified sender under one question per address, and drops the rest", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    const screened = await setup.policies.screen("conn", "gmail", [
      mail("m1", "Ann@Example.com"),
      mail("m2", "ann@example.com"),
      mail("m3", "ann@example.com"),
      mail("m4", "fake@example.com", false),
      { ...mail("m5", "x@y.com"), sender: { kind: "self" } },
    ])
    expect(screened.deliver.map((event) => event.key)).toEqual(["m5"])
    expect(screened).toMatchObject({ held: 3, dropped: 1 })
    const [inquiry] = setup.policies.inquiries()
    expect(inquiry).toMatchObject({ address: "ann@example.com", arrived: 3 })
    expect(inquiry?.held.map((held) => held.key)).toEqual(["m2", "m3"])
    await setup.policies.screen("conn", "gmail", [mail("m3", "ann@example.com")])
    expect(setup.policies.inquiries()).toHaveLength(1)
    expect(setup.policies.inquiries()[0]?.arrived).toBe(3)
  })

  it("releases the held mail when the address is allowed, with a gap for what it could not keep", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    await setup.policies.screen(
      "conn",
      "gmail",
      ["m1", "m2", "m3"].map((key) => mail(key, "ann@example.com")),
    )
    const [inquiry] = setup.policies.inquiries()
    if (inquiry === undefined) throw new Error("no inquiry")
    const result = await setup.policies.answer(inquiry.id, "allow-address", {
      kind: "channel",
      channelId: "discord",
      channelName: "Discord",
      person: "123",
    })
    expect(result).toMatchObject({ accepted: true, inquiry: { status: { state: "answered" } } })
    expect(setup.released).toHaveLength(1)
    expect(setup.released[0]?.events.map((event) => event.key)).toEqual(["m2", "m3"])
    expect(setup.released[0]?.gap).toContain("1 older message")
    expect(setup.store.policy("conn")?.rules).toEqual([
      {
        match: { kind: "address", value: "ann@example.com" },
        verdict: "allow",
        decidedAt: 1_000,
        origin: { kind: "channel", channelId: "discord", channelName: "Discord", person: "123" },
      },
    ])
    expect(await setup.policies.answer(inquiry.id, "deny-address", { kind: "web" })).toMatchObject({
      accepted: false,
      reason: "settled",
    })
    const later = await setup.policies.screen("conn", "gmail", [mail("m9", "ann@example.com")])
    expect(later.deliver.map((event) => event.key)).toEqual(["m9"])
  })

  it("drops the held mail on a deny, and settles the other questions a domain answer covers", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    await setup.policies.screen("conn", "gmail", [
      mail("m1", "ann@spam.example"),
      mail("m2", "bob@spam.example"),
      mail("m3", "cy@gmail.com"),
    ])
    const ann = setup.policies.inquiries().find((record) => record.address === "ann@spam.example")
    const cy = setup.policies.inquiries().find((record) => record.address === "cy@gmail.com")
    if (ann === undefined || cy === undefined) throw new Error("no inquiry")
    expect(await setup.policies.answer(cy.id, "allow-domain", { kind: "web" })).toEqual({
      accepted: false,
      reason: "not-offered",
    })
    await setup.policies.answer(ann.id, "deny-domain", { kind: "web" })
    expect(setup.released).toEqual([])
    const states = setup.policies.inquiries().map((record) => [record.address, record.status.state])
    expect(states).toEqual(
      expect.arrayContaining([
        ["ann@spam.example", "answered"],
        ["bob@spam.example", "covered"],
        ["cy@gmail.com", "pending"],
      ]),
    )
    expect(
      setup.policies
        .inquiries()
        .every((record) => record.status.state === "pending" || record.held.length === 0),
    ).toBe(true)
  })

  it("releases what waits when unknown senders become allowed, and drops it when they become hidden", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    await setup.policies.screen("conn", "gmail", [mail("m1", "ann@example.com")])
    await setup.policies.setUnknown("conn", "allow")
    expect(setup.released.map((release) => release.events.length)).toEqual([1])
    expect(setup.policies.inquiries()[0]?.status).toMatchObject({
      state: "covered",
      verdict: "allow",
    })
    await setup.policies.setUnknown("conn", "ask")
    await setup.policies.screen("conn", "gmail", [mail("m2", "bob@example.com")])
    await setup.policies.setUnknown("conn", "deny")
    expect(setup.released).toHaveLength(1)
    expect(
      setup.policies.inquiries().find((record) => record.address === "bob@example.com")?.status,
    ).toMatchObject({
      state: "covered",
      verdict: "deny",
    })
  })

  it("lets a question expire: the mail is dropped and the next mail asks again", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    await setup.policies.screen("conn", "gmail", [mail("m1", "ann@example.com")])
    setup.advance(30 * 24 * 60 * 60_000)
    await setup.policies.sweep()
    expect(setup.policies.inquiries()[0]?.status.state).toBe("expired")
    expect(setup.released).toEqual([])
    expect(setup.store.policy("conn")?.rules).toEqual([])
    await setup.policies.screen("conn", "gmail", [mail("m2", "ann@example.com")])
    expect(
      setup.policies.inquiries().filter((record) => record.status.state === "pending"),
    ).toHaveLength(1)
    setup.advance(2_000)
    await setup.policies.sweep()
    expect(setup.policies.inquiries().map((record) => record.status.state)).toEqual(["pending"])
  })

  it("refuses to screen or read an account without a policy, instead of assuming one", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await expect(
      setup.policies.screen("conn", "gmail", [mail("m1", "a@example.com")]),
    ).rejects.toThrow("no sender policy")
    expect(() => setup.policies.senders("conn").screen()).toThrow("no sender policy")
  })

  it("screens reads with one note, and refuses a hidden item by its id only", async () => {
    const setup = sendersSetup()
    await setup.store.migrate(["conn"])
    await setup.policies.putRules(
      "conn",
      [{ match: { kind: "address", value: "bad@example.com" }, verdict: "deny" }],
      {
        kind: "web",
      },
    )
    const screen = setup.policies.senders("conn").screen()
    expect(screen.admits(from("ok@example.com"))).toBe(true)
    expect(screen.admits(from("bad@example.com"))).toBe(false)
    expect(screen.note()).toBe("1 message hidden by the sender policy (1 denied).")
    expect(() =>
      setup.policies.senders("conn").require(from("bad@example.com"), "message m1"),
    ).toThrow("message m1 is hidden by the sender policy of this account")
  })

  it("copies a policy over another account's, and keeps rules unique per match", async () => {
    const setup = sendersSetup()
    await setup.store.migrate(["a", "b"])
    await setup.policies.putRules(
      "a",
      [{ match: { kind: "domain", value: "*.Example.com" }, verdict: "allow" }],
      {
        kind: "web",
      },
    )
    await setup.policies.putRules(
      "a",
      [{ match: { kind: "domain", value: "*.example.com" }, verdict: "deny" }],
      {
        kind: "web",
      },
    )
    expect(setup.store.policy("a")?.rules.map((item) => [item.match.value, item.verdict])).toEqual([
      ["*.example.com", "deny"],
    ])
    await expect(
      setup.policies.putRules(
        "a",
        [
          { match: { kind: "address", value: "x@y.com" }, verdict: "deny" },
          { match: { kind: "address", value: "X@y.com" }, verdict: "allow" },
        ],
        { kind: "web" },
      ),
    ).rejects.toThrow("listed twice")
    await setup.policies.setUnknown("a", "deny")
    await setup.policies.copy("a", "b")
    expect(setup.store.policy("b")).toEqual(setup.store.policy("a"))
    await setup.policies.removeRule("b", { kind: "domain", value: "*.example.com" })
    expect(setup.store.policy("b")?.rules).toEqual([])
    expect(setup.store.policy("a")?.rules).toHaveLength(1)
  })
})

describe("answering sender questions", () => {
  it("takes answers only from the owner in the Web UI or a channel's owners, of bots that see the account", async () => {
    const setup = sendersSetup()
    await setup.store.migrate([])
    await setup.store.start("conn", "connected")
    await setup.policies.screen("conn", "gmail", [mail("m1", "ann@example.com")])
    const answers = createSenderAnswers({
      policies: setup.policies,
      store: setup.store,
      bots: () => ["b1", "b2"],
      sees: (botId) => botId === "b1",
    })
    const [inquiry] = setup.policies.inquiries()
    if (inquiry === undefined) throw new Error("no inquiry")
    expect(answers.waiting()).toEqual({ b1: 1 })
    expect(answers.open("b2")).toEqual([])
    const channel = {
      id: "discord",
      name: "Discord",
      approvers: new Set(["owner"]),
      signal: new AbortController().signal,
    }
    expect(await answers.fromWeb({ kind: "viewer" }, inquiry.id, "allow-address")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(
      await answers.fromChannel("b1", channel, "someone", inquiry.id, "allow-address"),
    ).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(await answers.fromChannel("b2", channel, "owner", inquiry.id, "allow-address")).toEqual({
      accepted: false,
      reason: "not-found",
    })
    const seen: string[] = []
    const off = answers.subscribe((view, bots) =>
      seen.push(`${view.status.state}:${bots.join(",")}`),
    )
    expect(
      await answers.fromChannel("b1", channel, "owner", inquiry.id, "deny-address"),
    ).toMatchObject({
      accepted: true,
      inquiry: { status: { state: "answered", choice: "deny-address" } },
    })
    off()
    expect(seen).toEqual(["answered:b1"])
    expect(answers.waiting()).toEqual({})
  })
})
