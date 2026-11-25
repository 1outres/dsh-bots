import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SecretBytes, VAULT_KIT, type VaultSession } from "@1outres/dsh-bot-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createStatusCell } from "../src/cli/status"
import { OP_ENVIRONMENT_KEYS } from "../src/op/environment"
import { createOpHome } from "../src/op/home"
import { onePasswordProvider } from "../src/provider"
import { createOnePasswordSession, LIST_TTL_MS } from "../src/session"
import { containing, decodedDuring } from "./support/decoding"
import { createFakeOp, type FakeOp } from "./support/fake-op"
import {
  ITEM_ID,
  loginItem,
  OTP_CODE,
  OTP_FIELD_ID,
  PASSWORD,
  SECRETS,
  VAULT_ID,
} from "./support/op-json"

const TOKEN = "ops_eyJzaWduSW5BZGRyZXNzIjoibXkuMXBhc3N3b3JkLmNvbSJ9"
const encode = (text: string) => new TextEncoder().encode(text)
const signal = () => new AbortController().signal

const WHOAMI = "whoami --format json"
const VAULTS = "vault list --format json"
const ITEMS = `item list --vault ${VAULT_ID} --categories Login,Password --format json`
const ITEM = `item get ${ITEM_ID} --vault ${VAULT_ID} --format json`
const READ = `read --no-newline op://${VAULT_ID}/${ITEM_ID}/password`
const READ_OTP = `read --no-newline op://${VAULT_ID}/${ITEM_ID}/${OTP_FIELD_ID}?attribute=otp`

let fake: FakeOp
let parent: string
let clock: number
let sessions: VaultSession[]

beforeEach(() => {
  fake = createFakeOp()
  parent = mkdtempSync(join(tmpdir(), "op-homes-"))
  clock = 1_000_000
  sessions = []
  process.env.OP_CONNECT_HOST = "https://connect.invalid"
  process.env.OP_CONNECT_TOKEN = "connect-token"
})

afterEach(async () => {
  for (const session of sessions) await session.close()
  delete process.env.OP_CONNECT_HOST
  delete process.env.OP_CONNECT_TOKEN
  fake.remove()
  rmSync(parent, { recursive: true, force: true })
})

function provider() {
  return onePasswordProvider({
    installer: {
      status: createStatusCell({ state: "ready" }),
      binary: async () => fake.binary,
    },
    secret: VAULT_KIT.secret,
    temporaryDirectory: parent,
    now: () => clock,
  })
}

async function open(): Promise<VaultSession> {
  const session = await provider().open(
    { text: {}, secrets: { token: SecretBytes.from(encode(TOKEN)) } },
    signal(),
  )
  sessions.push(session)
  return session
}

const listed = (updatedAt = "2026-11-01T10:00:00Z") =>
  JSON.stringify([{ ...loginItem({ updated_at: updatedAt }), fields: undefined }])

function answerListing(updatedAt?: string) {
  fake.answer(VAULTS, { stdout: JSON.stringify([{ id: VAULT_ID, name: "Bots" }]) })
  fake.answer(ITEMS, { stdout: listed(updatedAt) })
  fake.answer(ITEM, { stdout: JSON.stringify(loginItem()) })
}

const count = (argv: string) => fake.calls().filter((call) => call.argv.join(" ") === argv).length

describe("the 1Password provider", () => {
  it("hands out passwords and one-time codes, never passkeys", () => {
    const made = provider()
    expect(made.id).toBe("onepassword")
    expect(made.id).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(made.kinds).toEqual(["password", "otp"])
    expect(made.setup).toEqual([
      expect.objectContaining({ key: "token", kind: "secret", required: true }),
    ])
    expect(made.guide).toMatch(/^https:\/\//)
  })

  it("takes the token's bytes and wipes the setup's secrets", async () => {
    const token = SecretBytes.from(encode(TOKEN))
    const extra = SecretBytes.from(encode("other"))
    sessions.push(await provider().open({ text: {}, secrets: { token, extra } }, signal()))
    expect(token.spent).toBe(true)
    expect(extra.spent).toBe(true)
  })

  it("refuses what is not a service account token without quoting it", async () => {
    const token = SecretBytes.from(encode("not-a-token secret-part"))
    const failure = provider().open({ text: {}, secrets: { token } }, signal())
    await expect(failure).rejects.toThrow(/starts with ops_/)
    await failure.catch((error: Error) => expect(error.message).not.toContain("secret-part"))
    expect(token.spent).toBe(true)
    await expect(provider().open({ text: {}, secrets: {} }, signal())).rejects.toThrow(/missing/)
  })

  it("has no passkey", async () => {
    expect((await open()).passkey).toBeUndefined()
  })
})

describe("a 1Password session", () => {
  it("identifies the service account", async () => {
    fake.answer(WHOAMI, {
      stdout: JSON.stringify({
        url: "https://example.1password.com",
        user_uuid: "SA1",
        account_uuid: "ACC",
        user_type: "SERVICE_ACCOUNT",
      }),
    })
    expect(await (await open()).identify(signal())).toEqual({
      subject: "https://example.1password.com#SA1",
      label: "1Password example.1password.com",
    })
  })

  it("runs op with its own environment only, in a private home", async () => {
    fake.answer(WHOAMI, { stdout: "{}" })
    await (await open()).identify(signal()).catch(() => {})
    const [call] = fake.calls()
    expect(Object.keys(call?.env ?? {}).sort()).toEqual([...OP_ENVIRONMENT_KEYS].sort())
    expect(call?.env.OP_SERVICE_ACCOUNT_TOKEN).toBe(TOKEN)
    expect(call?.env.OP_FORMAT).toBe("json")
    expect(call?.env.OP_CACHE).toBe("false")
    for (const path of [call?.env.HOME, call?.env.OP_CONFIG_DIR]) {
      expect(path?.startsWith(parent)).toBe(true)
      expect(statSync(path as string).mode & 0o777).toBe(0o700)
    }
    expect(call?.argv.join(" ")).not.toContain(TOKEN)
  })

  it("lists items with their fields and keeps no value", async () => {
    answerListing()
    const session = await open()
    let items: unknown
    const decoded = await decodedDuring(async () => {
      items = await session.listItems(signal())
    })
    expect(items).toEqual([
      expect.objectContaining({
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
        vaultName: "Bots",
        username: "bot@example.com",
        fields: [
          { id: "username", kind: "username", label: "username" },
          { id: "password", kind: "password", label: "password" },
          { id: OTP_FIELD_ID, kind: "otp", label: "one-time password" },
        ],
      }),
    ])
    expect(containing(decoded, SECRETS)).toEqual([])
    expect(JSON.stringify(items)).not.toContain(PASSWORD)
  })

  it("answers searches from one listing and reads only items that changed", async () => {
    answerListing()
    const session = await open()
    await session.listItems(signal())
    await session.listItems(signal())
    expect([count(VAULTS), count(ITEMS), count(ITEM)]).toEqual([1, 1, 1])
    clock += LIST_TTL_MS
    await session.listItems(signal())
    expect([count(VAULTS), count(ITEMS), count(ITEM)]).toEqual([2, 2, 1])
    fake.answer(ITEMS, { stdout: listed("2026-11-02T00:00:00Z") })
    clock += LIST_TTL_MS
    await session.listItems(signal())
    expect(count(ITEM)).toBe(2)
  })

  it("reads one item now, and none that is gone or out of reach", async () => {
    fake.answer(ITEM, { stdout: JSON.stringify(loginItem()) })
    const session = await open()
    expect((await session.item({ vaultId: VAULT_ID, itemId: ITEM_ID }, signal()))?.title).toBe(
      "Example \u00e9 login",
    )
    fake.answer(ITEM, {
      stderr: `[ERROR] 2026/11/25 12:00:00 "${ITEM_ID}" isn't an item in the "Bots" vault.`,
      code: 1,
    })
    expect(await session.item({ vaultId: VAULT_ID, itemId: ITEM_ID }, signal())).toBeUndefined()
    fake.answer(ITEM, { stderr: "[ERROR] (403) Forbidden", code: 1 })
    expect(await session.item({ vaultId: VAULT_ID, itemId: ITEM_ID }, signal())).toBeUndefined()
    expect(await session.item({ vaultId: "x/y", itemId: ITEM_ID }, signal())).toBeUndefined()
  })

  it("reveals a password as bytes it never decodes, and an OTP by its attribute", async () => {
    fake.answer(READ, { stdout: PASSWORD })
    fake.answer(READ_OTP, { stdout: OTP_CODE })
    const session = await open()
    let secret: SecretBytes | undefined
    const decoded = await decodedDuring(async () => {
      secret = await session.reveal(
        { vaultId: VAULT_ID, itemId: ITEM_ID, fieldId: "password", kind: "password" },
        signal(),
      )
    })
    expect(containing(decoded, SECRETS)).toEqual([])
    expect(String(secret)).toBe("[secret]")
    expect(await secret?.use((bytes) => Buffer.from(bytes).equals(Buffer.from(PASSWORD)))).toBe(
      true,
    )
    const otp = await session.reveal(
      { vaultId: VAULT_ID, itemId: ITEM_ID, fieldId: OTP_FIELD_ID, kind: "otp" },
      signal(),
    )
    expect(otp.length).toBe(OTP_CODE.length)
    otp.wipe()
    for (const call of fake.calls()) {
      expect(containing(call.argv, SECRETS)).toEqual([])
      expect(containing(Object.values(call.env), SECRETS)).toEqual([])
    }
  })

  it("refuses ids that would change the reference before running op", async () => {
    const session = await open()
    await expect(
      session.reveal(
        { vaultId: VAULT_ID, itemId: `${ITEM_ID}/x`, fieldId: "password", kind: "password" },
        signal(),
      ),
    ).rejects.toThrow(/not a 1Password item id/)
    await expect(
      session.reveal(
        { vaultId: VAULT_ID, itemId: ITEM_ID, fieldId: "p", kind: "passkey" },
        signal(),
      ),
    ).rejects.toThrow(/no passkey/)
    expect(fake.calls()).toEqual([])
  })

  it("explains a rate limit and never quotes op's output", async () => {
    fake.answer(READ, {
      stdout: PASSWORD,
      stderr: "[ERROR] (429) Too Many Requests: detail-from-op",
      code: 1,
    })
    const failure = (await open()).reveal(
      { vaultId: VAULT_ID, itemId: ITEM_ID, fieldId: "password", kind: "password" },
      signal(),
    )
    await expect(failure).rejects.toThrow(/rate limit/)
    await failure.catch((error: Error) => {
      expect(error.message).not.toContain("detail-from-op")
      expect(error.message).not.toContain(PASSWORD)
      expect(error.message).not.toContain(ITEM_ID)
    })
  })

  it("does not echo what op says about the token", async () => {
    fake.answer(WHOAMI, {
      stderr: "[ERROR] failed to DecodeSACredentials: invalid character 'Q' near ZZTOKENPART",
      code: 1,
    })
    const failure = (await open()).identify(signal())
    await expect(failure).rejects.toThrow(/did not accept the service account token/)
    await failure.catch((error: Error) => expect(error.message).not.toContain("ZZTOKENPART"))
  })

  it("stops op when the caller gives up", async () => {
    fake.answer(WHOAMI, { stdout: "{}", delayMs: 10_000 })
    const controller = new AbortController()
    const failure = (await open()).identify(controller.signal)
    setTimeout(() => controller.abort(), 100)
    await expect(failure).rejects.toThrow(/stopped/)
  })

  it("refuses answers that are not JSON without quoting them", async () => {
    fake.answer(ITEM, { stdout: `{"value":"${PASSWORD}"` })
    const failure = (await open()).item({ vaultId: VAULT_ID, itemId: ITEM_ID }, signal())
    await expect(failure).rejects.toThrow("1Password's answer is not JSON")
  })

  it("wipes the token and removes its home when closed", async () => {
    const token = encode(TOKEN)
    const home = await createOpHome(parent)
    const session = createOnePasswordSession({
      binary: fake.binary,
      token,
      home,
      secret: VAULT_KIT.secret,
      now: () => clock,
    })
    await session.close()
    expect(token.every((byte) => byte === 0)).toBe(true)
    expect(existsSync(home.home)).toBe(false)
    await expect(session.identify(signal())).rejects.toThrow(/closed/)
  })
})
