import { inspect } from "node:util"
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import { findPrints, indexPrints, printsOf, variantsOf } from "../src/host/vaults/fingerprints"
import { postDecision } from "../src/host/vaults/guard-decision"
import { rpIdAllowed, siteMatches } from "../src/shared/vaults"
import { base64Bytes, base64UrlBytes, jsonStringBytes } from "../src/vault-bytes"
import { SecretBytes } from "../src/vault-contract"
import {
  EXAMPLE,
  forRun,
  OWNER,
  run,
  testDigest,
  testGuardKeys,
  textOf,
  type VaultHarness,
  VIEWER,
  vaultHarness,
} from "./vaults-support"

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const LEAK = EXAMPLE.login.password
const BROWSER = { kind: "browser", origin: "https://login.example.test" } as const

async function loginGrant(h: VaultHarness, overrides: Record<string, unknown> = {}) {
  const account = await h.addAccount()
  const grant = await h.panel.grant(OWNER, "a", {
    accountId: account.id,
    vaultId: EXAMPLE.vaultId,
    itemId: EXAMPLE.login.itemId,
    kinds: ["username", "password", "otp"],
    connectors: ["browser"],
    ...overrides,
  })
  return { account, grant }
}

const result = (text: string): ToolExecutionResult => ({
  isError: false,
  value: { stdout: text },
  content: [{ type: "text", text }],
})
const accept = { kind: "accept" } as const

describe("SecretBytes", () => {
  it("hands its bytes over once, then zeroes them, even when the work throws", async () => {
    const secret = SecretBytes.from(encode("hunter2-secret"))
    expect(secret.length).toBe(14)
    let seen: Uint8Array | undefined
    expect(
      await secret.use((bytes) => {
        seen = bytes
        return decode(bytes)
      }),
    ).toBe("hunter2-secret")
    expect(seen?.every((byte) => byte === 0)).toBe(true)
    expect(secret.spent).toBe(true)
    await expect(secret.use(() => 1)).rejects.toThrow("already used")
    let failed: Uint8Array | undefined
    await expect(
      SecretBytes.from(encode("another-secret")).use((bytes) => {
        failed = bytes
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(failed?.every((byte) => byte === 0)).toBe(true)
  })

  it("moves the given bytes into its own array, a pooled Buffer included, and zeroes them", async () => {
    const pooled = Buffer.from("hunter2-secret")
    const neighbour = Buffer.from("neighbour-data")
    const secret = SecretBytes.from(pooled)
    expect(pooled.every((byte) => byte === 0)).toBe(true)
    expect(neighbour.toString()).toBe("neighbour-data")
    expect(await textOf(secret)).toBe("hunter2-secret")
  })

  it("never prints its value", () => {
    const secret = SecretBytes.from(encode("hunter2-secret"))
    for (const shown of [
      String(secret),
      `${secret}`,
      JSON.stringify({ secret }),
      inspect(secret),
      inspect({ secret }),
    ]) {
      expect(shown).not.toContain("hunter2")
      expect(shown).toContain("[secret]")
    }
  })
})

describe("vault bytes", () => {
  it("encodes like Buffer and JSON.stringify, without strings", () => {
    for (const text of ["", "a", "ab", "abc", 'pässwörd"\\\n\u0001</>+/=']) {
      const bytes = encode(text)
      expect(decode(base64Bytes(bytes))).toBe(Buffer.from(bytes).toString("base64"))
      expect(decode(base64UrlBytes(bytes))).toBe(Buffer.from(bytes).toString("base64url"))
      expect(decode(jsonStringBytes(bytes))).toBe(JSON.stringify(text).slice(1, -1))
    }
  })
})

describe("sites", () => {
  const sites = [
    { origin: "https://example.com", subdomains: true },
    { origin: "http://localhost:8443", subdomains: false },
  ]
  it("matches the scheme, host and port; subdomains only when asked", () => {
    expect(siteMatches(sites, "https://example.com")).toBe(true)
    expect(siteMatches(sites, "https://login.example.com")).toBe(true)
    expect(siteMatches(sites, "http://example.com")).toBe(false)
    expect(siteMatches(sites, "https://example.com:8443")).toBe(false)
    expect(siteMatches(sites, "https://evilexample.com")).toBe(false)
    expect(siteMatches(sites, "https://example.com.evil.test")).toBe(false)
    expect(siteMatches(sites, "http://localhost:8443")).toBe(true)
    expect(siteMatches(sites, "http://a.localhost:8443")).toBe(false)
  })
  it("takes a relying party that is the host or a parent domain of it", () => {
    expect(rpIdAllowed("example.com", "https://login.example.com")).toBe(true)
    expect(rpIdAllowed("other.com", "https://login.example.com")).toBe(false)
    expect(rpIdAllowed("com", "https://example.com")).toBe(false)
    expect(rpIdAllowed("localhost", "http://localhost:8443")).toBe(true)
  })
})

describe("fingerprints", () => {
  const keys = testGuardKeys(encode("k".repeat(32)), encode("s".repeat(16)))
  const secret = 'p@ss w0rd/<&>"é+'
  const forms = [
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    new URLSearchParams({ x: secret }).toString().slice(2),
    secret
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;"),
    Buffer.from(secret).toString("hex"),
    Buffer.from(secret).toString("hex").toUpperCase(),
    Buffer.from(secret).toString("base64"),
    Buffer.from(`x${secret}`).toString("base64"),
    Buffer.from(`xy${secret}`).toString("base64"),
    Buffer.from(`xy${secret}tail`).toString("base64url"),
  ]
  it("finds every form of a secret in text", async () => {
    const prints = indexPrints(
      (await printsOf(encode(secret), keys, testDigest)).map((print) => ({
        ...print,
        grantId: "cred-1",
        kind: "password",
      })),
    )
    for (const form of forms) {
      const found = await findPrints(encode(`before ${form} after`), prints, keys, testDigest)
      expect(found.length, form).toBeGreaterThan(0)
    }
    expect(
      await findPrints(encode("nothing to see here at all"), prints, keys, testDigest),
    ).toEqual([])
  })
  it("keys its probes: another key gives other probes", async () => {
    const other = testGuardKeys(encode("o".repeat(32)), encode("s".repeat(16)))
    const mine = await printsOf(encode(secret), keys, testDigest)
    const theirs = await printsOf(encode(secret), other, testDigest)
    expect(mine.map((print) => print.probe)).not.toEqual(theirs.map((print) => print.probe))
    expect(keys.id).not.toBe(other.id)
  })
  it("keeps no print of a value shorter than 6 bytes", async () => {
    expect(await printsOf(encode("12345"), keys, testDigest)).toEqual([])
    expect(variantsOf(encode("123456")).length).toBeGreaterThan(0)
  })
})

describe("vault access", () => {
  it("reveals an allowed field for an allowed origin and connector, records it and fingerprints the password", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    const password = await run(h).reveal(grant.id, "password", BROWSER)
    expect(await textOf(password)).toBe(LEAK)
    h.advance(1)
    expect(await textOf(await run(h).reveal(grant.id, "username", BROWSER))).toBe("alice")
    h.advance(1)
    expect(await textOf(await run(h).reveal(grant.id, "otp", BROWSER))).toMatch(/^\d{6}$/)
    expect(h.store.uses("a").map((use) => [use.kind, use.outcome])).toEqual([
      ["otp", "filled"],
      ["username", "filled"],
      ["password", "filled"],
    ])
    expect(JSON.stringify([...h.tables.vaultUses.rows.values()])).not.toContain(LEAK)
    expect(h.store.fingerprint("a", grant.id, "password")?.state).toBe("fingerprinted")
  })

  it("hands over the value when the provider returns a Node Buffer", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    const handed: Buffer[] = []
    const opened = await h.sessions.session(grant.accountId, new AbortController().signal)
    const reveal = opened.reveal.bind(opened)
    opened.reveal = async (ref, signal) => {
      const secret = await reveal(ref, signal)
      return secret.use((bytes) => {
        const pooled = Buffer.from(bytes)
        handed.push(pooled)
        return SecretBytes.from(pooled)
      })
    }
    expect(await textOf(await run(h).reveal(grant.id, "password", BROWSER))).toBe(LEAK)
    expect(handed.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true)
  })

  it("refuses another bot's handle, a malformed one, a field, connector, origin or desktop not allowed", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h, { kinds: ["password"] })
    const browser = (origin: string) => ({ kind: "browser", origin }) as const
    await expect(run(h, "b").reveal(grant.id, "password", BROWSER)).rejects.toThrow(
      "not one of this bot's credentials",
    )
    await expect(run(h).reveal("cred-nope", "password", BROWSER)).rejects.toThrow(
      "not one of this bot's credentials",
    )
    await expect(run(h).reveal(grant.id, "otp", BROWSER)).rejects.toThrow(
      "did not allow the one-time code",
    )
    await expect(
      forRun(h, { connector: "desktop" }).access.reveal(grant.id, "password", BROWSER),
    ).rejects.toThrow("did not allow this connector")
    for (const origin of [
      "https://evil.test",
      "http://login.example.test",
      "https://a.login.example.test",
    ]) {
      await expect(run(h).reveal(grant.id, "password", browser(origin))).rejects.toThrow(
        "may not be used on",
      )
    }
    await expect(
      run(h).reveal(grant.id, "password", { kind: "desktop", application: "xterm" }),
    ).rejects.toThrow("desktop applications")
    const refused = h.store.uses("a").filter((use) => use.outcome === "refused")
    expect(refused).toHaveLength(6)
    expect(JSON.stringify(refused)).not.toContain(LEAK)
  })

  it("tells the bot bot-core's words for a provider failure, and the owner the provider's", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    const opened = await h.sessions.session(grant.accountId, new AbortController().signal)
    opened.reveal = async () => {
      throw new Error("op read op://botsvault1/example1/password: denied")
    }
    const error = await run(h)
      .reveal(grant.id, "password", BROWSER)
      .catch((caught: Error) => caught)
    expect(String(error)).not.toContain("op://")
    expect(String(error)).toContain("could not provide")
    expect(h.store.uses("a")[0]?.reason).toContain("op://")
    expect(h.warnings.join("\n")).not.toContain("op://")
  })

  it("wipes what a run handed out when it ends, and hands nothing once cancelled", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    const lease = forRun(h)
    const kept = await lease.access.reveal(grant.id, "password", BROWSER)
    lease.release()
    expect(kept.spent).toBe(true)
    await expect(lease.access.reveal(grant.id, "password", BROWSER)).rejects.toThrow("ended")
    const controller = new AbortController()
    const cancelled = forRun(h, { signal: controller.signal })
    const opened = await h.sessions.session(grant.accountId, new AbortController().signal)
    const reveal = opened.reveal.bind(opened)
    opened.reveal = async (ref, signal) => {
      controller.abort()
      return reveal(ref, signal)
    }
    await expect(cancelled.access.reveal(grant.id, "password", BROWSER)).rejects.toThrow(
      "cancelled",
    )
  })

  it("hands a passkey only for its relying party", async () => {
    const h = vaultHarness()
    const account = await h.addAccount()
    const grant = await h.panel.grant(OWNER, "a", {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.local.itemId,
      kinds: ["password", "passkey"],
      connectors: ["browser"],
      sites: [
        { origin: "http://localhost:8443", subdomains: false },
        { origin: "https://elsewhere.test", subdomains: false },
      ],
    })
    const passkey = await run(h).passkey(grant.id, {
      kind: "browser",
      origin: "http://localhost:8443",
    })
    expect(passkey.rpId).toBe("localhost")
    passkey.privateKey.wipe()
    await expect(
      run(h).passkey(grant.id, { kind: "browser", origin: "https://elsewhere.test" }),
    ).rejects.toThrow("is for localhost")
    expect(h.store.fingerprint("a", grant.id, "passkey")?.state).toBe("fingerprinted")
  })

  it("hands nothing when the use cannot be recorded", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    h.tables.vaultUses.put = async () => {
      throw new Error("disk full")
    }
    await expect(run(h).reveal(grant.id, "password", BROWSER)).rejects.toThrow(
      "could not record the use",
    )
  })
})

describe("vault guard", () => {
  it("withholds a secret in a tool result, records a redacted incident and tells the owner", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    for (const leaked of [LEAK, Buffer.from(LEAK).toString("base64"), encodeURIComponent(LEAK)]) {
      const verdict = await h.checks.toolResult("a", {
        agentId: "agent-1",
        tool: "bash",
        result: result(`cat secret.txt\n${leaked}\n`),
        decision: accept,
      })
      expect(verdict.kind).toBe("withheld")
      expect(JSON.stringify(verdict)).not.toContain(leaked)
      expect(JSON.stringify(verdict)).toContain(`[withheld: secret of ${grant.label} (password)]`)
    }
    const [incident] = h.store.incidents("a")
    expect(incident).toMatchObject({
      source: "tool-result",
      outcome: "redacted",
      tool: "bash",
      repeats: 2,
    })
    expect(h.store.openIncidents()).toEqual({ a: 1 })
    expect(JSON.stringify([...h.tables.vaultIncidents.rows.values()])).not.toContain(LEAK)
    expect(
      await h.checks.toolResult("b", {
        agentId: "x",
        tool: "bash",
        result: result(LEAK),
        decision: accept,
      }),
    ).toEqual({ kind: "clean" })
  })

  it("finds the escapes, encodings and number forms other tools write", async () => {
    const h = vaultHarness()
    const account = await h.addAccount()
    await h.panel.grant(OWNER, "a", {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.local.itemId,
      kinds: ["password"],
      connectors: ["browser"],
    })
    const secret = EXAMPLE.local.password
    const python = JSON.stringify(secret).replace(
      /[!-/]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    const cases = [
      python,
      encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()),
      encodeURIComponent(secret).replace(/!/g, "%21"),
      secret.replace(/!/g, "&#x21;"),
      Buffer.from(`some prefix ${secret} and suffix that is long`)
        .toString("base64")
        .replace(/(.{12})/g, "$1\n"),
    ]
    for (const leaked of cases) {
      const scan = await h.guard.scan("a", { text: `see: ${leaked}` })
      expect(scan.changed, leaked).toBe(true)
      expect(JSON.stringify(scan), leaked).not.toContain(leaked)
    }
  })

  it("looks at numbers, skips image data, and withholds what is past its limit unread", async () => {
    const h = vaultHarness({ scanLimit: 4096 })
    await loginGrant(h)
    const pixels = Buffer.from(`png ${LEAK}`).toString("base64")
    const scan = await h.guard.scan("a", {
      value: { type: "image", data: LEAK, pin: 123456789 },
      content: [
        { type: "image", data: pixels, name: LEAK },
        { type: "text", text: "x".repeat(5000) },
      ],
    })
    expect(scan.changed).toBe(true)
    if (!scan.changed) throw new Error("unchanged")
    expect(scan.cut).toBe(true)
    const shown = JSON.stringify(scan.redacted)
    expect(shown).toContain("too long for the vault guard")
    expect(shown).toContain(pixels)
    expect(shown).not.toContain(LEAK)
  })

  it("fails closed when the incident cannot be stored", async () => {
    const h = vaultHarness()
    await loginGrant(h)
    h.tables.vaultIncidents.put = async () => {
      throw new Error("disk full")
    }
    const verdict = await h.checks.toolResult("a", {
      agentId: "agent-1",
      tool: "bash",
      result: result(LEAK),
      decision: accept,
    })
    expect(verdict.kind).toBe("failed")
    const decision = postDecision(verdict, result(LEAK), accept)
    expect(decision.kind).toBe("block")
    expect(JSON.stringify(decision)).not.toContain(LEAK)
  })

  it("fails closed after the guard key changed, until the login is fingerprinted again", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    for (const record of h.tables.vaultFingerprints.rows.values()) {
      h.tables.vaultFingerprints.rows.set(`a:${record.grantId}:${record.kind}`, {
        ...record,
        keyId: "0000",
      })
    }
    const verdict = await h.checks.toolResult("a", {
      agentId: "a1",
      tool: "bash",
      result: result("ok"),
      decision: accept,
    })
    expect(verdict.kind).toBe("failed")
    expect(
      (await h.checks.toolArguments("a", { agentId: "a1", tool: "bash", args: { command: "ls" } }))
        .kind,
    ).toBe("deny")
    expect(h.panel.bot(OWNER, "a").grants[0]?.guard[0]?.state).toBe("stale")
    await h.panel.updateGrant(OWNER, "a", grant.id, {})
    expect(h.panel.bot(OWNER, "a").grants[0]?.guard[0]?.state).toBe("fingerprinted")
    expect(
      (
        await h.checks.toolResult("a", {
          agentId: "a1",
          tool: "bash",
          result: result("ok"),
          decision: accept,
        })
      ).kind,
    ).toBe("clean")
  })

  it("keeps looking for a removed login's secret for a while", async () => {
    const h = vaultHarness()
    const { account, grant } = await loginGrant(h)
    await h.panel.revoke(OWNER, "a", grant.id)
    const scan = await h.guard.scan("a", [LEAK])
    expect(scan.changed && scan.findings[0]?.label).toBe("Example login")
    h.advance(31 * 24 * 60 * 60_000)
    await h.panel.grant(OWNER, "a", {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.local.itemId,
      kinds: ["password"],
      connectors: ["browser"],
    })
    expect((await h.guard.scan("a", [LEAK])).changed).toBe(false)
  })

  it("replaces a success through its value and blocks a failure", async () => {
    const h = vaultHarness()
    await loginGrant(h)
    const leaked = result(`x ${LEAK}`)
    const verdict = await h.checks.toolResult("a", {
      agentId: "a1",
      tool: "bash",
      result: leaked,
      decision: accept,
    })
    expect(postDecision(verdict, leaked, accept)).toMatchObject({
      kind: "accept",
      value: { stdout: expect.stringContaining("[withheld") },
    })
    const failure: ToolExecutionResult = {
      isError: true,
      error: { message: `no: ${LEAK}` },
      content: [{ type: "text", text: `Error: no: ${LEAK}` }],
    }
    const failed = await h.checks.toolResult("a", {
      agentId: "a1",
      tool: "bash",
      result: failure,
      decision: accept,
    })
    const blocked = postDecision(failed, failure, accept)
    expect(blocked.kind).toBe("block")
    expect(JSON.stringify(blocked)).not.toContain(LEAK)
  })

  it("refuses arguments holding a secret, and records what the bot wrote or was sent", async () => {
    const h = vaultHarness()
    await loginGrant(h)
    const verdict = await h.checks.toolArguments("a", {
      agentId: "a1",
      tool: "bash",
      args: { command: `echo ${LEAK}` },
    })
    expect(verdict.kind).toBe("deny")
    expect(JSON.stringify(verdict)).not.toContain(LEAK)
    expect(
      await h.checks.toolArguments("a", { agentId: "a1", tool: "bash", args: { command: "ls" } }),
    ).toEqual({ kind: "allow" })
    await h.checks.assistantMessage("a", "s1", [{ type: "reasoning", text: `it is ${LEAK}` }])
    const inbound = await h.guard.shield({ botId: "a", sessionId: "s1" }, "inbound-message", {
      text: `here: ${LEAK}`,
    })
    expect(JSON.stringify(inbound)).not.toContain(LEAK)
    const notice = await h.guard.shield({ botId: "a" }, "bot-context", {
      text: `result ${LEAK}`,
      summary: "s",
    })
    expect(JSON.stringify(notice)).not.toContain(LEAK)
    expect(
      h.store
        .incidents("a")
        .map((incident) => `${incident.source}:${incident.outcome}`)
        .sort(),
    ).toEqual([
      "assistant-message:exposed",
      "bot-context:redacted",
      "inbound-message:redacted",
      "tool-arguments:exposed",
    ])
  })

  it("marks a password too short to look for, and looks for nothing then", async () => {
    const h = vaultHarness()
    const account = await h.addAccount()
    const grant = await h.panel.grant(OWNER, "a", {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.short.itemId,
      kinds: ["password"],
      connectors: ["browser"],
    })
    expect(grant.guard).toEqual([{ kind: "password", state: "short", at: expect.any(Number) }])
    expect(h.guard.guards("a")).toBe(false)
  })
})

describe("vault panel", () => {
  it("refuses every call of anyone but the owner", async () => {
    const h = vaultHarness()
    const { account, grant } = await loginGrant(h)
    const calls: (() => unknown)[] = [
      () => h.panel.snapshot(VIEWER),
      () => h.panel.bot(VIEWER, "a"),
      () =>
        h.panel.addAccount(VIEWER, { provider: "fake-vault", label: "x", values: { token: "y" } }),
      () => h.panel.renameAccount(VIEWER, account.id, "x"),
      () => h.panel.removeAccount(VIEWER, account.id),
      () => h.panel.listItems(VIEWER, account.id, ""),
      () => h.panel.grant(VIEWER, "a", {}),
      () => h.panel.updateGrant(VIEWER, "a", grant.id, {}),
      () => h.panel.revoke(VIEWER, "a", grant.id),
      () => h.panel.acknowledgeIncident(VIEWER, "a", "vinc-1"),
      () => h.panel.snapshot(undefined),
    ]
    for (const call of calls) {
      await expect(Promise.resolve().then(call)).rejects.toThrow("only the owner")
    }
  })

  it("never returns a value: setup secrets stay in the credential store", async () => {
    const h = vaultHarness()
    const { account } = await loginGrant(h)
    const items = await h.panel.listItems(OWNER, account.id, "")
    expect(items.map((item) => item.title)).toEqual([
      "Example login",
      "Local test site",
      "Short PIN",
    ])
    const shown = JSON.stringify([h.panel.snapshot(OWNER), h.panel.bot(OWNER, "a"), items])
    for (const secret of [LEAK, EXAMPLE.local.password, "JBSWY3DPEHPK3PXP", "t0ken"]) {
      expect(shown).not.toContain(secret)
    }
    expect(JSON.stringify([...h.tables.vaultAccounts.rows.values()])).not.toContain("t0ken")
    expect(JSON.stringify([...h.credentials.records.values()])).toContain("t0ken")
    expect(h.panel.snapshot(OWNER).fillers).toEqual([{ id: "browser", name: "Browser" }])
  })

  it("refuses a login without connectors, a field the item lacks and sites that are not origins", async () => {
    const h = vaultHarness()
    const account = await h.addAccount()
    const base = {
      accountId: account.id,
      vaultId: EXAMPLE.vaultId,
      itemId: EXAMPLE.login.itemId,
      connectors: ["browser"],
    }
    await expect(
      h.panel.grant(OWNER, "a", { ...base, kinds: ["password"], connectors: [] }),
    ).rejects.toThrow("at least one connector")
    await expect(h.panel.grant(OWNER, "a", { ...base, kinds: ["passkey"] })).rejects.toThrow(
      "no passkey",
    )
    await expect(
      h.panel.grant(OWNER, "a", {
        ...base,
        kinds: ["password"],
        sites: [{ origin: "https://x.test/path", subdomains: false }],
      }),
    ).rejects.toThrow("not an http(s) origin")
    await expect(h.panel.grant(OWNER, "nobody", { ...base, kinds: ["password"] })).rejects.toThrow(
      "does not exist",
    )
  })

  it("gives the item's https sites by default; a removed login is not usable", async () => {
    const h = vaultHarness()
    const { grant } = await loginGrant(h)
    expect(grant.sites).toEqual([{ origin: "https://login.example.test", subdomains: false }])
    await h.panel.revoke(OWNER, "a", grant.id)
    await expect(run(h).reveal(grant.id, "password", BROWSER)).rejects.toThrow(
      "not one of this bot's credentials",
    )
  })

  it("acknowledges an incident, and removes an account with its logins", async () => {
    const h = vaultHarness()
    const { account } = await loginGrant(h)
    await h.checks.assistantMessage("a", "s1", [LEAK])
    const [incident] = h.store.incidents("a")
    if (incident === undefined) throw new Error("no incident")
    expect(
      (await h.panel.acknowledgeIncident(OWNER, "a", incident.id)).acknowledgedAt,
    ).toBeDefined()
    expect(h.panel.snapshot(OWNER).openIncidents).toEqual({})
    expect(await h.panel.removeAccount(OWNER, account.id)).toEqual({ removedGrants: 1 })
    expect(h.store.grants("a")).toEqual([])
    expect([...h.credentials.records.keys()].some((key) => key.includes(account.id))).toBe(false)
  })

  it("drops a session that connected while its account was removed, and wipes a setup the provider refused", async () => {
    const h = vaultHarness()
    const account = await h.addAccount()
    await h.sessions.close(account.id)
    const opening = h.sessions.session(account.id, new AbortController().signal)
    await h.panel.removeAccount(OWNER, account.id)
    await expect(opening).rejects.toThrow()
    const secrets: SecretBytes[] = []
    const open = h.provider.open.bind(h.provider)
    Object.assign(h.provider, {
      open: async (setup: Parameters<typeof open>[0]) => {
        secrets.push(...Object.values(setup.secrets))
        throw new Error("refused")
      },
    })
    await expect(h.addAccount()).rejects.toThrow("did not accept")
    expect(secrets.length).toBeGreaterThan(0)
    expect(secrets.every((secret) => secret.spent)).toBe(true)
  })
})
