import { describe, expect, it } from "vitest"
import { readJson } from "../src/json/reader"
import { identityOf, itemOf, listedItemsOf, OpOutputError, vaultsOf } from "../src/op/items"
import { containing, decodedDuring } from "./support/decoding"
import { ITEM_ID, json, loginItem, OTP_FIELD_ID, SECRETS, VAULT_ID } from "./support/op-json"

const read = <T>(value: unknown, map: (doc: ReturnType<typeof readJson>) => T) => {
  const bytes = json(value)
  const doc = readJson(bytes)
  try {
    return { result: map(doc), bytes }
  } finally {
    doc.wipe()
  }
}

describe("itemOf", () => {
  it("takes names, ids, URLs and the username, and leaves every value undecoded", async () => {
    let outcome: ReturnType<typeof read<ReturnType<typeof itemOf>>> | undefined
    const decoded = await decodedDuring(() => {
      outcome = read(loginItem(), itemOf)
    })
    expect(containing(decoded, SECRETS)).toEqual([])
    expect(outcome?.result).toEqual({
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      vaultName: "Bots",
      title: "Example \u00e9 login",
      websites: ["https://example.com/login", "https://accounts.example.com"],
      username: "bot@example.com",
      fields: [
        { id: "username", kind: "username", label: "username" },
        { id: "password", kind: "password", label: "password" },
        { id: OTP_FIELD_ID, kind: "otp", label: "one-time password" },
      ],
      updatedAt: Date.parse("2026-11-01T10:00:00Z"),
    })
    expect(JSON.stringify(outcome?.result)).not.toMatch(
      new RegExp(SECRETS.map((secret) => secret.replace(/[?&.+]/g, "\\$&")).join("|")),
    )
    expect(outcome?.bytes.every((byte) => byte === 0)).toBe(true)
  })

  it("reads a Password item, which has no username", () => {
    const item = loginItem({
      category: "PASSWORD",
      fields: [
        { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: "x" },
      ],
    })
    expect(read(item, itemOf).result?.fields).toEqual([
      { id: "password", kind: "password", label: "password" },
    ])
    expect(read(item, itemOf).result?.username).toBeUndefined()
  })

  it("keeps the first field of a kind and skips fields whose id cannot be referenced", () => {
    const item = loginItem({
      fields: [
        {
          id: "bad/id?attribute=x",
          type: "CONCEALED",
          purpose: "PASSWORD",
          label: "p",
          value: "a",
        },
        { id: "second", type: "CONCEALED", purpose: "PASSWORD", label: "p2", value: "b" },
        { id: "third", type: "CONCEALED", purpose: "PASSWORD", label: "p3", value: "c" },
        { id: "nouser", type: "STRING", purpose: "USERNAME", label: "username", value: "" },
      ],
    })
    const result = read(item, itemOf).result
    expect(result?.fields).toEqual([{ id: "second", kind: "password", label: "p2" }])
    expect(result?.username).toBeUndefined()
  })

  it("is undefined for a category bots do not log in with", () => {
    expect(read(loginItem({ category: "SECURE_NOTE" }), itemOf).result).toBeUndefined()
  })

  it("refuses an answer without ids or with malformed ones", () => {
    expect(() => read(loginItem({ id: "../x" }), itemOf)).toThrow(OpOutputError)
    expect(() => read(loginItem({ vault: { name: "Bots" } }), itemOf)).toThrow(OpOutputError)
  })
})

describe("listings", () => {
  it("reads vaults and items without fields", async () => {
    const vaults = read([{ id: VAULT_ID, name: "Bots", content_version: 3 }], vaultsOf).result
    expect(vaults).toEqual([{ id: VAULT_ID, name: "Bots" }])
    const listed = { ...loginItem(), fields: undefined }
    let items: unknown
    const decoded = await decodedDuring(() => {
      items = read([listed], listedItemsOf).result
    })
    expect(items).toEqual([
      { vaultId: VAULT_ID, itemId: ITEM_ID, updatedAt: "2026-11-01T10:00:00Z" },
    ])
    expect(containing(decoded, SECRETS)).toEqual([])
  })
})

describe("identityOf", () => {
  it("names a service account by its account URL and user id", () => {
    const whoami = {
      url: "https://example.1password.com",
      URL: "https://example.1password.com",
      user_uuid: "USERUUID",
      account_uuid: "ACCOUNTUUID",
      user_type: "SERVICE_ACCOUNT",
      ServiceAccountType: "SERVICE_ACCOUNT",
    }
    expect(read(whoami, identityOf).result).toEqual({
      subject: "https://example.1password.com#USERUUID",
      label: "1Password example.1password.com",
    })
  })

  it("refuses a person's sign-in", () => {
    expect(() =>
      read({ url: "https://my.1password.com", user_uuid: "U", user_type: "HUMAN" }, identityOf),
    ).toThrow(/not a 1Password service account/)
  })
})
