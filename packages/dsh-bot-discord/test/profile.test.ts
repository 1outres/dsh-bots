import type { BotChannelProfile } from "@1outres/dsh-bot-core"
import { DiscordAPIError } from "discord.js"
import { describe, expect, it } from "vitest"
import type { DiscordAccount, DiscordProfileOutcome } from "../src/host/discord"
import { profileRefusal } from "../src/host/discordjs/failures"
import type { ProfileRecord } from "../src/host/profile/domain"
import { createProfilePresenter } from "../src/host/profile/presenter"
import { openProfileRecords, purgeProfileRecords } from "../src/host/profile/records"
import { discordUsernameOf } from "../src/host/profile/username"
import { DM_SETTINGS, fakeActions, fakeLink, memoryTable, settle } from "./support"

const SELF: DiscordAccount = { id: "555555555555555555", username: "old-name", tag: "old-name" }

function profile(name: string, digest = "av-1"): BotChannelProfile {
  return {
    digest: `${name}|${digest}`,
    name,
    avatar: { mediaType: "image/png", size: 512, data: new Uint8Array([1, 2, 3]), digest },
  }
}

const RATE_LIMITED: DiscordProfileOutcome = {
  ok: false,
  refusal: { kind: "rate-limited", message: "You are changing your username too fast." },
}

function setup(
  options: {
    table?: ReturnType<typeof memoryTable<ProfileRecord>>
    setUsername?: () => Promise<DiscordProfileOutcome>
  } = {},
) {
  const table = options.table ?? memoryTable<ProfileRecord>()
  const link = fakeLink(DM_SETTINGS)
  const warnings: string[] = []
  const { actions, calls } = fakeActions(
    options.setUsername === undefined ? {} : { setUsername: options.setUsername },
  )
  let closed = false
  const presenter = createProfilePresenter({
    link: link.link,
    actions,
    records: openProfileRecords(table, "b1"),
    closed: () => closed,
    warn: (message) => warnings.push(message),
  })
  return {
    table,
    presenter,
    calls,
    reports: link.profileReports,
    warnings,
    close() {
      closed = true
    },
  }
}

describe("Discord username", () => {
  it.each([
    ["  Helper   Bot ", { ok: true, username: "Helper Bot" }],
    ["x", { ok: false, reason: "length" }],
    ["a".repeat(33), { ok: false, reason: "length" }],
    ["ボット", { ok: true, username: "ボット" }],
    ["me@home", { ok: false, reason: "part", part: "@" }],
    ["My Discord Bot", { ok: false, reason: "part", part: "discord" }],
    ["Here", { ok: false, reason: "reserved" }],
  ])("%j", (name, expected) => {
    expect(discordUsernameOf(name)).toEqual(expected)
  })
})

describe("profile refusals", () => {
  it("tells a username rate limit from other refusals, and passes other errors on", () => {
    const formError = (code: string, message: string) =>
      new DiscordAPIError(
        {
          code: 50035,
          message: "Invalid Form Body",
          errors: { username: { _errors: [{ code, message }] } },
        },
        50035,
        400,
        "PATCH",
        "/users/@me",
        {},
      )
    expect(profileRefusal(formError("USERNAME_RATE_LIMIT", "Too fast."))).toEqual({
      kind: "rate-limited",
      message: "Too fast.",
    })
    expect(profileRefusal(formError("USERNAME_INVALID", "Not allowed."))).toEqual({
      kind: "rejected",
      message: "Not allowed.",
    })
    expect(
      profileRefusal(
        new DiscordAPIError({ code: 0, message: "Slow down" }, 0, 429, "PATCH", "/users/@me", {}),
      ),
    ).toEqual({ kind: "rate-limited", message: "Slow down" })
    expect(profileRefusal(new Error("socket hang up"))).toBeUndefined()
  })
})

describe("profile presenter", () => {
  it("waits for the connection, then sets the avatar and the username once and records them", async () => {
    const { presenter, calls, reports, table } = setup()
    presenter.received(profile("Helper"))
    await settle()
    expect(calls).toEqual([])
    presenter.ready(SELF)
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3", "setUsername Helper"])
    expect(reports).toEqual([{ digest: "Helper|av-1", state: "synced" }])
    expect(table.map.get("b1")).toEqual({
      botId: "b1",
      userId: SELF.id,
      username: "Helper",
      avatar: "av-1",
    })
  })

  it("applies nothing again after a restart, and only what changed afterwards", async () => {
    const table = memoryTable<ProfileRecord>()
    await table.put("b1", { botId: "b1", userId: SELF.id, username: "Helper", avatar: "av-1" })
    const { presenter, calls, reports } = setup({ table })
    presenter.ready(SELF)
    presenter.received(profile("Helper"))
    await settle()
    expect(calls).toEqual([])
    expect(reports).toEqual([{ digest: "Helper|av-1", state: "synced" }])
    presenter.received(profile("Helper", "av-2"))
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3"])
  })

  it("applies everything again to another Discord user", async () => {
    const table = memoryTable<ProfileRecord>()
    await table.put("b1", { botId: "b1", userId: SELF.id, username: "Helper", avatar: "av-1" })
    const { presenter, calls } = setup({ table })
    presenter.ready({ id: "666666666666666666", username: "other", tag: "other" })
    presenter.received(profile("Helper"))
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3", "setUsername Helper"])
  })

  it("leaves a username Discord already has", async () => {
    const { presenter, calls } = setup()
    presenter.ready({ ...SELF, username: "Helper" })
    presenter.received(profile("Helper"))
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3"])
  })

  it("sets the avatar but reports a name Discord does not take, without asking Discord", async () => {
    const { presenter, calls, reports, warnings } = setup()
    presenter.ready(SELF)
    presenter.received(profile("Q"))
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3"])
    expect(reports).toMatchObject([
      { digest: "Q|av-1", state: "failed", problems: [{ en: expect.stringContaining("2 to 32") }] },
    ])
    expect(warnings).toHaveLength(1)
  })

  it("reports a rate limit, keeps the connection and tries the username again at the next connection", async () => {
    let refuse = true
    const { presenter, calls, reports, table } = setup({
      async setUsername() {
        calls.push("setUsername")
        return refuse ? RATE_LIMITED : { ok: true }
      },
    })
    presenter.ready(SELF)
    presenter.received(profile("Helper"))
    await settle()
    expect(reports).toMatchObject([
      {
        state: "failed",
        problems: [{ en: expect.stringContaining("only a few changes an hour") }],
      },
    ])
    expect(table.map.get("b1")).toEqual({ botId: "b1", userId: SELF.id, avatar: "av-1" })
    refuse = false
    presenter.ready(SELF)
    await settle()
    expect(calls).toEqual(["setAvatar image/png 3", "setUsername", "setUsername"])
    expect(reports.at(-1)).toEqual({ digest: "Helper|av-1", state: "synced" })
  })

  it("reports only the latest profile, and nothing once closed", async () => {
    const { presenter, reports, close } = setup()
    presenter.ready(SELF)
    presenter.received(profile("Helper"))
    presenter.received(profile("Helper Two"))
    await settle()
    expect(reports).toEqual([{ digest: "Helper Two|av-1", state: "synced" }])
    close()
    presenter.received(profile("Helper Three"))
    await settle()
    expect(reports).toHaveLength(1)
  })

  it("reports an unreachable Discord", async () => {
    const link = fakeLink(DM_SETTINGS)
    const { actions } = fakeActions({
      async setAvatar() {
        throw new Error("socket hang up")
      },
    })
    const presenter = createProfilePresenter({
      link: link.link,
      actions,
      records: openProfileRecords(memoryTable(), "b1"),
      closed: () => false,
      warn: () => {},
    })
    presenter.ready(SELF)
    presenter.received(profile("Helper"))
    await settle()
    expect(link.profileReports).toMatchObject([
      { state: "failed", problems: [{ en: expect.stringContaining("socket hang up") }] },
    ])
  })

  it("keeps the applied avatar when the username cannot reach Discord", async () => {
    const { presenter, table } = setup({
      async setUsername() {
        throw new Error("socket hang up")
      },
    })
    presenter.ready(SELF)
    presenter.received(profile("Helper"))
    await settle()
    expect(table.map.get("b1")).toEqual({ botId: "b1", userId: SELF.id, avatar: "av-1" })
  })

  it("forgets the records of deleted bots", async () => {
    const table = memoryTable<ProfileRecord>()
    await table.put("b1", { botId: "b1", userId: SELF.id })
    await table.put("b2", { botId: "b2", userId: SELF.id })
    await purgeProfileRecords(table, (botId) => botId === "b2")
    expect([...table.map.keys()]).toEqual(["b2"])
  })
})
