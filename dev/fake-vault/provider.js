import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { totp } from "./otp.js"

export const FAKE_VAULT_ID = "fake-vault"

const EXAMPLE_ITEMS = JSON.parse(
  readFileSync(new URL("./items.example.json", import.meta.url), "utf8"),
)

const fieldsOf = (item) => [
  ...(item.username === undefined ? [] : [{ id: "username", kind: "username", label: "username" }]),
  ...(item.password === undefined ? [] : [{ id: "password", kind: "password", label: "password" }]),
  ...(item.totp === undefined ? [] : [{ id: "totp", kind: "otp", label: "one-time password" }]),
  ...(item.passkey === undefined ? [] : [{ id: "passkey", kind: "passkey", label: "passkey" }]),
]

function summaryOf(vault, item) {
  return {
    vaultId: vault.id,
    itemId: item.id,
    vaultName: vault.name,
    title: item.title,
    websites: item.websites ?? [],
    ...(item.username === undefined ? {} : { username: item.username }),
    fields: fieldsOf(item),
    updatedAt: item.updatedAt ?? 0,
  }
}

function passkeysOf(vaults) {
  const keys = new Map()
  for (const vault of vaults) {
    for (const item of vault.items) {
      if (item.passkey === undefined) continue
      const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
      keys.set(`${vault.id}/${item.id}`, {
        rpId: item.passkey.rpId,
        credentialId: randomBytes(16),
        userHandle: Buffer.from(item.username ?? item.id),
        privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }),
        publicKey: pair.publicKey.export({ type: "spki", format: "der" }),
      })
    }
  }
  return keys
}

function publishPasskeys(path, keys) {
  const entries = [...keys.values()].map((key) => ({
    rpId: key.rpId,
    credentialId: key.credentialId.toString("base64url"),
    userHandle: key.userHandle.toString("base64url"),
    publicKey: key.publicKey.toString("base64"),
  }))
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 })
}

export function fakeVaultProvider({ secret, passkeys, now = Date.now }) {
  return {
    id: FAKE_VAULT_ID,
    name: "Fake vault",
    development: true,
    setup: [
      {
        key: "token",
        label: { en: "Token", ja: "トークン" },
        kind: "secret",
        required: true,
        help: { en: "Any text; it names the account." },
      },
      {
        key: "items",
        label: { en: "Items file", ja: "項目のファイル" },
        kind: "text",
        required: false,
        help: { en: "A JSON file on the Host; the example items when empty." },
      },
    ],
    kinds: ["password", "otp", "passkey"],
    async open(setup) {
      const token = setup.secrets.token
      if (token === undefined) throw new Error("the token is missing")
      const subject = await token.use((bytes) =>
        createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      )
      const data =
        setup.text.items === undefined || setup.text.items === ""
          ? EXAMPLE_ITEMS
          : JSON.parse(readFileSync(setup.text.items, "utf8"))
      const keys = passkeysOf(data.vaults)
      if (passkeys !== undefined) publishPasskeys(passkeys, keys)
      const find = (ref) => {
        const vault = data.vaults.find((each) => each.id === ref.vaultId)
        const item = vault?.items.find((each) => each.id === ref.itemId)
        return vault === undefined || item === undefined ? undefined : { vault, item }
      }
      let closed = false
      const open = () => {
        if (closed) throw new Error("the fake vault session is closed")
      }
      return {
        async identify() {
          open()
          return { subject: `fake-vault:${subject}`, label: `Fake vault ${subject.slice(0, 6)}` }
        },
        async listItems() {
          open()
          return data.vaults.flatMap((vault) => vault.items.map((item) => summaryOf(vault, item)))
        },
        async item(ref) {
          open()
          const found = find(ref)
          return found === undefined ? undefined : summaryOf(found.vault, found.item)
        },
        async reveal(ref) {
          open()
          const found = find(ref)
          if (found === undefined) throw new Error("no such item")
          if (
            ref.kind === "password" &&
            ref.fieldId === "password" &&
            found.item.password !== undefined
          ) {
            return secret(new TextEncoder().encode(found.item.password))
          }
          if (ref.kind === "otp" && ref.fieldId === "totp" && found.item.totp !== undefined) {
            return secret(new TextEncoder().encode(totp(found.item.totp, now())))
          }
          throw new Error("no such field")
        },
        async passkey(ref) {
          open()
          const key = keys.get(`${ref.vaultId}/${ref.itemId}`)
          if (key === undefined || ref.fieldId !== "passkey") throw new Error("no such passkey")
          return {
            rpId: key.rpId,
            credentialId: new Uint8Array(key.credentialId),
            userHandle: new Uint8Array(key.userHandle),
            signCount: 0,
            privateKey: secret(new Uint8Array(key.privateKey)),
          }
        },
        async close() {
          closed = true
        },
      }
    },
  }
}
