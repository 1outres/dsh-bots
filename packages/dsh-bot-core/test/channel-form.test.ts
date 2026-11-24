import { describe, expect, it } from "vitest"
import {
  changeWith,
  channelHeadline,
  listIssue,
  listItemsOf,
  listTextOf,
  missingFields,
  ownersEmpty,
  textIssue,
} from "../src/client/channel-form"
import type {
  BotChannelListField,
  BotChannelTextField,
  BotChannelView,
} from "../src/shared/channels"
import { FIELDS } from "./channels-support"

const view: BotChannelView = {
  channel: { id: "chat", name: "Chat", fields: FIELDS },
  enabled: true,
  values: { server: "abc", users: ["1", "2"] },
  secrets: { token: true },
  status: { state: "connecting" },
}

const server = FIELDS[1] as BotChannelTextField
const users = FIELDS[2] as BotChannelListField

describe("channel settings", () => {
  it("saves one edit over what is stored, other secrets kept", () => {
    expect(changeWith(view, { kind: "enabled", enabled: false })).toEqual({
      enabled: false,
      values: { server: "abc", users: ["1", "2"] },
      secrets: {},
    })
    expect(changeWith(view, { kind: "value", key: "users", value: ["3"] })).toEqual({
      enabled: true,
      values: { server: "abc", users: ["3"] },
      secrets: {},
    })
    expect(changeWith(view, { kind: "secret", key: "token", secret: " new " }).secrets).toEqual({
      token: { op: "set", value: "new" },
    })
    expect(changeWith(view, { kind: "secret", key: "token", secret: null }).secrets).toEqual({
      token: { op: "clear" },
    })
  })

  it("fills a field the view lacks with its empty value", () => {
    const sparse = { ...view, values: {} }
    expect(changeWith(sparse, { kind: "enabled", enabled: true }).values).toEqual({
      server: "",
      users: [],
    })
  })

  it("reads lists one per line and splits typed ones by line or comma", () => {
    expect(listTextOf(view, "users")).toBe("1\n2")
    expect(listItemsOf("1, 3\n\n4 ")).toEqual(["1", "3", "4"])
  })

  it("finds what the Host would refuse in a typed value", () => {
    expect(textIssue(server, " abc ")).toBeNull()
    expect(textIssue(server, "")).toBeNull()
    expect(textIssue(server, "ABC")).toEqual({ kind: "format" })
    expect(textIssue(server, "a".repeat(33))).toEqual({ kind: "length", max: 32 })
    expect(listIssue(users, "1\n2")).toBeNull()
    expect(listIssue(users, "1\nx")).toEqual({ kind: "item", item: "x" })
    expect(listIssue(users, "123456789")).toEqual({ kind: "item", item: "123456789" })
    expect(listIssue(users, "1,2,3,4")).toEqual({ kind: "count", max: 3 })
    expect(listIssue(users, "1,1,1,1")).toBeNull()
  })

  it("tells when the owners field names nobody", () => {
    const owned: BotChannelView = { ...view, channel: { ...view.channel, owners: "users" } }
    expect(ownersEmpty(owned)).toBe(false)
    expect(ownersEmpty({ ...owned, values: { server: "", users: [] } })).toBe(true)
    expect(ownersEmpty({ ...view, values: { server: "", users: [] } })).toBe(false)
  })

  it("heads the channel with its worst state: failed, incomplete, then no owners", () => {
    const owned: BotChannelView = {
      ...view,
      channel: { ...view.channel, owners: "users" },
      values: { server: "", users: [] },
    }
    expect(channelHeadline({ ...view, enabled: false, status: { state: "off" } })).toEqual({
      tone: "idle",
      state: "off",
    })
    expect(channelHeadline({ ...owned, status: { state: "failed", message: "bad" } })).toEqual({
      tone: "danger",
      state: "failed",
      meta: "bad",
    })
    expect(
      channelHeadline({ ...owned, status: { state: "incomplete", missing: ["token"] } }),
    ).toEqual({
      tone: "warning",
      state: "incomplete",
    })
    expect(channelHeadline({ ...owned, status: { state: "connected", account: "bot#1" } })).toEqual(
      {
        tone: "warning",
        state: "noOwners",
        meta: "bot#1",
      },
    )
    expect(channelHeadline({ ...view, status: { state: "connected", account: "bot#1" } })).toEqual({
      tone: "success",
      state: "connected",
      meta: "bot#1",
    })
    expect(channelHeadline({ ...view, status: { state: "waiting" } }).tone).toBe("busy")
  })

  it("lists the missing required fields only while incomplete", () => {
    expect([
      ...missingFields({ ...view, status: { state: "incomplete", missing: ["token"] } }),
    ]).toEqual(["token"])
    expect(missingFields(view).size).toBe(0)
  })
})
