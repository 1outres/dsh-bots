/**
 * The browser's login tools on the Host: the value reaches only the
 * helper's standard input (after the line that announces it), is wiped
 * there, goes to the origin the helper located, and never into a result,
 * an argv or Playwright MCP.
 */
import type {
  BotConnectorRun,
  BotCredential,
  BotEnvironmentProcess,
  BotEnvironmentSpawn,
  BotVaultAccess,
  CredentialTarget,
  SecretBytes,
} from "@1outres/dsh-bot-core"
import { VAULT_KIT } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { BrowserConnections } from "../src/host/connections"
import type { McpServer } from "../src/host/mcp/server"
import type { BrowserAttachment } from "../src/host/session"
import { type PasskeySlot, passkeySlot } from "../src/host/vault/passkeys"
import { vaultTools } from "../src/host/vault/tools"
import { deadline, fakeEnvironment } from "./support"

const MARK = "fedcba9876543210fedcba9876543210"
const VALUE = "s3cret-Pässword!"
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const LOGIN: BotCredential = {
  handle: "cred-1",
  label: "Example login",
  sites: [{ origin: "https://example.com", subdomains: false }],
  kinds: ["username", "password", "otp"],
  desktop: false,
}

/** A helper whose answers the test scripts; every write is kept as given (to check the wipe). */
function fakeHelper(
  script: (input: Uint8Array[], reply: (line: object) => void, ended: boolean) => void,
) {
  const writes: Uint8Array[] = []
  const copies: Uint8Array[] = []
  const queue: string[] = []
  let wake: (() => void) | undefined
  let closed = false
  let stdinEnded = false
  let finish: (value: { exitCode: number | null; signal: string | null }) => void = () => {}
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    finish = resolve
  })
  const answered: string[] = []
  let cancelledAtClose = false
  const reply = (line: object) => {
    answered.push(Object.keys(line)[0] as string)
    queue.push(`${JSON.stringify(line)}\n`)
    wake?.()
  }
  const process: BotEnvironmentProcess = {
    stdin: {
      async write(data) {
        writes.push(data)
        copies.push(data.slice())
        script(copies, reply, stdinEnded)
      },
      async end() {
        stdinEnded = true
        script(copies, reply, stdinEnded)
      },
    },
    stdout: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift()
          if (next !== undefined) {
            yield encoder.encode(next)
            continue
          }
          if (closed) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
    },
    stderr: () => "",
    done,
    terminate() {
      cancelledAtClose = answered.includes("cancelled") && queue.length === 0
      closed = true
      wake?.()
      finish({ exitCode: null, signal: "SIGTERM" })
    },
  }
  return {
    process,
    writes,
    copies,
    isClosed: () => closed,
    /** Whether the helper had answered "cancelled" by the time it was terminated. */
    cancelledBeforeClose: () => cancelledAtClose,
  }
}

function fakeVault(options: { refuse?: string; credential?: BotCredential } = {}) {
  const reveals: { handle: string; field: string; target: CredentialTarget }[] = []
  const secrets: SecretBytes[] = []
  const vault: BotVaultAccess = {
    async describe(handle) {
      if (handle !== "cred-1") throw new Error("not one of this bot's credentials")
      return options.credential ?? LOGIN
    },
    async reveal(handle, field, target) {
      reveals.push({ handle, field, target })
      if (options.refuse !== undefined) throw new Error(options.refuse)
      const secret = VAULT_KIT.secret(encoder.encode(VALUE))
      secrets.push(secret)
      return secret
    },
    async passkey(handle, target) {
      reveals.push({ handle, field: "passkey", target })
      if (options.refuse !== undefined) throw new Error(options.refuse)
      const privateKey = VAULT_KIT.secret(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]))
      secrets.push(privateKey)
      return {
        rpId: "example.com",
        credentialId: new Uint8Array([1, 2, 3]),
        signCount: 0,
        privateKey,
      }
    },
  }
  return { vault, reveals, secrets }
}

function mcp() {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const server = {
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return { content: [{ type: "text", text: '### Result\n"marked"' }], isError: false }
    },
  } as unknown as McpServer
  return { server, calls }
}

function setup(
  helper: ReturnType<typeof fakeHelper>,
  vault: BotVaultAccess,
  passkeys?: (environment: ReturnType<typeof fakeEnvironment>["environment"]) => PasskeySlot,
) {
  const spawned: BotEnvironmentSpawn[] = []
  const machine = fakeEnvironment(
    () => ({}),
    (spec) => {
      spawned.push(spec)
      return helper.process
    },
  )
  const server = mcp()
  const attachment: BrowserAttachment = {
    mcp: server.server,
    passkeys:
      passkeys?.(machine.environment) ??
      passkeySlot({
        environment: machine.environment,
        signal: new AbortController().signal,
        kit: VAULT_KIT,
        deadline,
      }),
  }
  const run: BotConnectorRun<BrowserAttachment> = {
    bot: { id: "b1", name: "Bot" },
    settings: {},
    environment: machine.environment,
    signal: new AbortController().signal,
    trigger: { kind: "call" },
    attachment,
    vault,
  }
  const tools = vaultTools({
    connections: new BrowserConnections(),
    kit: VAULT_KIT,
    mark: () => MARK,
    deadline,
  })
  const tool = (name: string) => {
    const found = tools.find((entry) => entry.name === name)
    if (found === undefined) throw new Error(`no ${name}`)
    return found as unknown as {
      execute(args: object, run: BotConnectorRun<BrowserAttachment>): Promise<{ text?: string }>
    }
  }
  return { run, spawned, calls: server.calls, tool }
}

/** Answers as the fill helper: located at `origin`, then filled once the value arrived. */
const fillScript =
  (origin: string) => (input: Uint8Array[], reply: (line: object) => void, ended: boolean) => {
    if (input.length === 1 && !ended) reply({ located: { origin, element: "input:password" } })
    if (input.length === 1 && ended) reply({ cancelled: true })
    if (input.length === 2) reply({ filled: { submitted: true } })
  }

describe("browser_fill_credential", () => {
  it("is a vault tool that runs alone on the page and is allowed by default", () => {
    const tools = vaultTools({
      connections: new BrowserConnections(),
      kit: VAULT_KIT,
      mark: () => MARK,
      deadline,
    })
    expect(tools.map((tool) => [tool.name, tool.permission, tool.exclusive, tool.vault])).toEqual([
      ["fill_credential", "allow", "page", true],
      ["use_passkey", "allow", "page", true],
    ])
  })

  it("marks the ref through Playwright MCP, reveals for the located origin and writes the value to the helper's stdin only", async () => {
    const helper = fakeHelper(fillScript("https://example.com"))
    const { vault, reveals, secrets } = fakeVault()
    const { run, spawned, calls, tool } = setup(helper, vault)
    const result = await tool("fill_credential").execute(
      { credential: "cred-1", field: "password", ref: "e12", submit: true },
      run,
    )
    expect(result.text).toBe(
      'Filled the password of "Example login" in https://example.com and pressed Enter. The value is not shown to you; take a browser_snapshot to see the page.',
    )
    expect(calls).toEqual([
      {
        name: "browser_evaluate",
        args: {
          element: "the field to fill",
          target: "e12",
          function: `(element) => { element.setAttribute("data-dsh-fill", "${MARK}"); return "marked" }`,
        },
      },
    ])
    expect(reveals).toEqual([
      {
        handle: "cred-1",
        field: "password",
        target: { kind: "browser", origin: "https://example.com" },
      },
    ])
    expect(spawned.map((spec) => spec.argv)).toEqual([
      ["node", "/opt/dsh-browser/helper/dsh-browser-fill.mjs"],
    ])
    expect(spawned[0]?.env).toBeUndefined()
    expect(JSON.parse(decoder.decode(helper.copies[0]))).toEqual({
      devtools: "127.0.0.1:9222",
      mark: MARK,
      field: "password",
    })
    const sent = decoder.decode(helper.copies[1])
    const header = JSON.stringify({
      fill: { origin: "https://example.com", submit: true, length: encoder.encode(VALUE).length },
    })
    expect(sent).toBe(`${header}\n${VALUE}`)
    expect(helper.writes[1]?.every((byte) => byte === 0)).toBe(true)
    expect(secrets.every((secret) => secret.spent)).toBe(true)
    expect(JSON.stringify(calls)).not.toContain(VALUE)
    expect(JSON.stringify(spawned)).not.toContain(VALUE)
    expect(helper.isClosed()).toBe(true)
  })

  it("sends no value and says why when the vault refuses the located origin", async () => {
    const helper = fakeHelper(fillScript("https://evil.example"))
    const { vault } = fakeVault({ refuse: "https://evil.example is not one of this login's sites" })
    const { run, tool } = setup(helper, vault)
    await expect(
      tool("fill_credential").execute({ credential: "cred-1", field: "password", ref: "e12" }, run),
    ).rejects.toThrow(
      'the password of "Example login" may not be filled in https://evil.example: https://evil.example is not one of this login\'s sites',
    )
    expect(helper.copies).toHaveLength(1)
    expect(helper.cancelledBeforeClose()).toBe(true)
  })

  it("explains a helper's failure by its code, and refuses a field the login does not allow", async () => {
    const helper = fakeHelper((input, reply) => {
      if (input.length === 1) reply({ error: "not-password-field" })
    })
    const { vault, reveals } = fakeVault()
    const { run, tool } = setup(helper, vault)
    await expect(
      tool("fill_credential").execute({ credential: "cred-1", field: "password", ref: "e3" }, run),
    ).rejects.toThrow(/a password goes only into a password field/)
    expect(reveals).toEqual([])

    const otpless = fakeVault({ credential: { ...LOGIN, kinds: ["username", "password"] } })
    const other = setup(
      fakeHelper(() => {}),
      otpless.vault,
    )
    await expect(
      other
        .tool("fill_credential")
        .execute({ credential: "cred-1", field: "otp", ref: "e3" }, other.run),
    ).rejects.toThrow('"Example login" has no otp this bot may use')
    expect(other.calls).toEqual([])
  })
})

describe("browser_use_passkey", () => {
  const passkeyScript = (input: Uint8Array[], reply: (line: object) => void, ended: boolean) => {
    if (input.length === 1 && !ended) reply({ located: { origin: "https://example.com" } })
    if (input.length === 2) reply({ ready: { origin: "https://example.com" } })
  }

  it("marks the tab, gets the passkey for its origin, hands the key to the resident helper and returns at once", async () => {
    const helper = fakeHelper(passkeyScript)
    const { vault, reveals, secrets } = fakeVault({ credential: { ...LOGIN, kinds: ["passkey"] } })
    const { run, spawned, calls, tool } = setup(helper, vault)
    const result = await tool("use_passkey").execute({ credential: "cred-1" }, run)
    expect(result.text).toMatch(
      /^The passkey of "Example login" is offered to https:\/\/example.com for 60 seconds\./,
    )
    expect(calls[0]?.args).toEqual({
      function: `() => { document.documentElement.setAttribute("data-dsh-passkey", "${MARK}"); return "marked" }`,
    })
    expect(reveals).toEqual([
      {
        handle: "cred-1",
        field: "passkey",
        target: { kind: "browser", origin: "https://example.com" },
      },
    ])
    expect(spawned.map((spec) => spec.argv)).toEqual([
      ["node", "/opt/dsh-browser/helper/dsh-browser-passkey.mjs"],
    ])
    const sent = helper.copies[1] as Uint8Array
    const newline = sent.indexOf(0x0a)
    expect(JSON.parse(decoder.decode(sent.subarray(0, newline)))).toEqual({
      passkey: {
        origin: "https://example.com",
        rpId: "example.com",
        credentialId: "AQID",
        signCount: 0,
        seconds: 60,
        length: 8,
      },
    })
    expect([...sent.subarray(newline + 1)]).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
    expect(helper.writes[1]?.every((byte) => byte === 0)).toBe(true)
    expect(secrets.every((secret) => secret.spent)).toBe(true)
    expect(helper.isClosed()).toBe(false)
    run.attachment.passkeys.release()
    expect(helper.isClosed()).toBe(true)
  })

  it("fails plainly for a login without a passkey (1Password), touching neither the page nor the vault", async () => {
    const helper = fakeHelper(passkeyScript)
    const { vault, reveals } = fakeVault()
    const { run, calls, spawned, tool } = setup(helper, vault)
    await expect(tool("use_passkey").execute({ credential: "cred-1" }, run)).rejects.toThrow(
      /"Example login" has no passkey this bot may use .*browser_fill_credential/,
    )
    expect([calls, spawned, reveals]).toEqual([[], [], []])
  })

  it("ends the helper when the vault refuses the tab's origin", async () => {
    const helper = fakeHelper(passkeyScript)
    const { vault } = fakeVault({
      refuse: "not a site of this login",
      credential: { ...LOGIN, kinds: ["passkey"] },
    })
    const { run, tool } = setup(helper, vault)
    await expect(tool("use_passkey").execute({ credential: "cred-1" }, run)).rejects.toThrow(
      'the passkey of "Example login" may not be used in https://example.com: not a site of this login',
    )
    expect(helper.copies).toHaveLength(1)
    expect(helper.isClosed()).toBe(true)
  })
})
