import { describe, expect, it } from "vitest"
import type { ChannelRecord } from "../src/host/channels/domain"
import { createChannelSettings } from "../src/host/channels/settings"
import { createSecretVault, vaultKey } from "../src/host/channels/vault"
import type { BotChannelDescriptor } from "../src/shared/channels"
import { FIELDS, memoryTable, memoryVault } from "./channels-support"

const channel: BotChannelDescriptor = { id: "chat", name: "Chat", fields: FIELDS }

function setup() {
  const records = memoryTable<ChannelRecord>()
  const vault = memoryVault()
  const settings = createChannelSettings({ records, vault, now: () => 5 })
  const changes: string[] = []
  settings.subscribe((botId, channelId) => changes.push(`${botId}:${channelId}`))
  return { records, vault, settings, changes }
}

const enable = {
  enabled: true,
  values: { server: "abc", users: ["1"] },
  secrets: { token: { op: "set", value: "secret-1" } },
} as const

describe("channel settings", () => {
  it("are off and empty before anything is stored", () => {
    const { settings } = setup()
    expect(settings.view("b", channel)).toEqual({
      enabled: false,
      values: { server: "", users: [] },
      secrets: { token: false },
    })
    expect(settings.readiness("b", channel)).toEqual({ state: "off" })
  })

  it("keep secrets in the vault and only their presence in the record", async () => {
    const { records, vault, settings, changes } = setup()
    await settings.configure("b", channel, enable)
    expect(vault.stored.get("b:chat")).toEqual({ token: "secret-1" })
    expect(records.rows.get("b:chat")).toEqual({
      botId: "b",
      channelId: "chat",
      enabled: true,
      values: { server: "abc", users: ["1"] },
      secrets: ["token"],
      updatedAt: 5,
    })
    expect(JSON.stringify(settings.view("b", channel))).not.toContain("secret-1")
    expect(settings.view("b", channel).secrets).toEqual({ token: true })
    expect(settings.readiness("b", channel)).toEqual({ state: "ready" })
    expect(changes).toEqual(["b:chat"])
    expect(settings.revision("b", "chat")).toBe(1)
  })

  it("keep, replace and clear a secret", async () => {
    const { vault, settings } = setup()
    await settings.configure("b", channel, enable)
    await settings.configure("b", channel, { ...enable, secrets: { token: { op: "keep" } } })
    expect(vault.stored.get("b:chat")).toEqual({ token: "secret-1" })
    await settings.configure("b", channel, {
      ...enable,
      secrets: { token: { op: "set", value: "secret-2" } },
    })
    expect(await settings.resolve("b", channel)).toEqual({
      token: "secret-2",
      server: "abc",
      users: ["1"],
    })
    await settings.configure("b", channel, { ...enable, secrets: { token: { op: "clear" } } })
    expect(vault.stored.has("b:chat")).toBe(false)
    expect(settings.readiness("b", channel)).toEqual({ state: "incomplete", missing: ["token"] })
  })

  it("refuse to resolve a secret the vault lost", async () => {
    const { vault, settings } = setup()
    await settings.configure("b", channel, enable)
    vault.stored.clear()
    await expect(settings.resolve("b", channel)).rejects.toThrow("set it again")
  })

  it("forget the settings and secrets of deleted bots", async () => {
    const { records, vault, settings } = setup()
    await settings.configure("gone", channel, enable)
    await settings.configure("kept", channel, enable)
    await settings.purge((botId) => botId === "kept")
    expect([...records.rows.keys()]).toEqual(["kept:chat"])
    expect([...vault.stored.keys()]).toEqual(["kept:chat"])
  })
})

describe("secret vault", () => {
  function records() {
    const stored = new Map<string, { kind: string; payload?: unknown }>()
    return {
      stored,
      readRecord: async (key: string) => stored.get(key),
      async modifyRecord(
        key: string,
        mutate: () => Promise<{ kind: "grant"; payload: unknown } | undefined>,
      ) {
        const next = await mutate()
        if (next !== undefined) stored.set(key, next)
      },
      async deleteRecord(key: string) {
        stored.delete(key)
      },
    }
  }

  it("names one bot-core credential record per bot and channel", () => {
    expect(vaultKey("0a1b2c3d", "discord")).toBe("bot-core/channel-discord-0a1b2c3d")
    expect(() => vaultKey("Bad Id", "discord")).toThrow("no credential key")
  })

  it("writes, reads and removes a grant record", async () => {
    const store = records()
    const vault = createSecretVault(store)
    await vault.write("b1", "discord", { token: "t" })
    expect(store.stored.get("bot-core/channel-discord-b1")).toEqual({
      kind: "grant",
      payload: { version: 1, secrets: { token: "t" } },
    })
    expect(await vault.read("b1", "discord")).toEqual({ token: "t" })
    await vault.write("b1", "discord", {})
    expect(store.stored.size).toBe(0)
    expect(await vault.read("b1", "discord")).toEqual({})
  })

  it("refuses a record it did not write", async () => {
    const store = records()
    store.stored.set("bot-core/channel-discord-b1", { kind: "api-key" })
    await expect(createSecretVault(store).read("b1", "discord")).rejects.toThrow(
      "not one bot-core wrote",
    )
  })
})
