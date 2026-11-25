/**
 * The login helpers of vm/helper/ run against a fake DevTools: they type
 * exactly the value, only into the marked element of the expected origin,
 * and never print it (design rule 66).
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { FILL_ATTRIBUTE, PASSKEY_ATTRIBUTE } from "../src/host/vault/marks"
import { type FakeDevtoolsModel, type FakeElement, startFakeDevtools } from "./fake-devtools"

const HELPER = fileURLToPath(new URL("../vm/helper/", import.meta.url))
const MARK = "0123456789abcdef0123456789abcdef"
const VALUE = 'pa"ss\\wörd-🙂-Z9x'
const VALUE_BYTES = new TextEncoder().encode(VALUE)
const PASSWORD_INPUT: FakeElement = {
  tag: "input",
  type: "password",
  editable: false,
  disabled: false,
  password: true,
}
const TEXT_INPUT: FakeElement = {
  tag: "input",
  type: "email",
  editable: false,
  disabled: false,
  password: false,
}

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

function model(
  options: { element?: FakeElement; origin?: string; marks?: number; iframe?: string } = {},
) {
  const value: FakeDevtoolsModel = {
    element: options.element ?? PASSWORD_INPUT,
    tabs: [
      {
        targetId: "tab-1",
        type: "page",
        main: {
          id: "main-1",
          origin: options.origin ?? "https://example.com",
          marks: options.iframe === undefined ? (options.marks ?? 1) : 0,
          children:
            options.iframe === undefined
              ? []
              : [{ id: "child-1", origin: options.iframe, marks: 1 }],
        },
      },
      {
        targetId: "tab-2",
        type: "page",
        main: { id: "main-2", origin: "https://other.example", marks: 0 },
      },
    ],
  }
  return value
}

/** A helper process and its output lines, collected as they come. */
function run(script: string) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [`${HELPER}${script}`], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  const waiters: (() => void)[] = []
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8")
    for (const wake of waiters.splice(0)) wake()
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)))
  closers.push(async () => {
    child.kill()
    await exited
  })
  const lines = () =>
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  return {
    child,
    exited,
    lines,
    output: () => stdout + stderr,
    async line(index: number) {
      while (lines().length <= index) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          child.once("exit", () => resolve())
        })
        if (child.exitCode !== null && lines().length <= index)
          throw new Error(`exited: ${stdout} ${stderr}`)
      }
      return lines()[index] as Record<string, unknown>
    },
    write: (data: string | Uint8Array) => child.stdin.write(data),
    end: () => child.stdin.end(),
  }
}

async function devtools(value: FakeDevtoolsModel) {
  const fake = await startFakeDevtools(value)
  closers.push(fake.close)
  return fake
}

const fillOrder = (origin: string, submit = false) =>
  `${JSON.stringify({ fill: { origin, submit, length: VALUE_BYTES.length } })}\n`

describe("dsh-browser-fill", () => {
  it("types exactly the value into the marked element of the expected origin, then unmarks it and presses Enter", async () => {
    const fake = await devtools(model())
    const helper = run("dsh-browser-fill.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field: "password" })}\n`)
    expect(await helper.line(0)).toEqual({
      located: { origin: "https://example.com", element: "input:password" },
    })
    helper.write(fillOrder("https://example.com", true))
    helper.write(VALUE_BYTES)
    expect(await helper.line(1)).toEqual({ filled: { submitted: true } })
    expect(await helper.exited).toBe(0)
    const inserted = fake.log.filter((entry) => entry.method === "Input.insertText")
    expect(inserted.map((entry) => entry.params.text)).toEqual([VALUE])
    expect(inserted[0]?.sessionId).toBe("s-tab-1")
    const methods = fake.log.map((entry) => entry.method)
    expect(methods.indexOf("DOM.focus")).toBeLessThan(methods.indexOf("Input.insertText"))
    expect(methods.lastIndexOf("Page.getFrameTree")).toBeLessThan(
      methods.indexOf("Input.insertText"),
    )
    expect(methods.filter((method) => method === "Input.dispatchKeyEvent")).toHaveLength(2)
    const unmarked = fake.log.findIndex((entry) =>
      String(entry.params.functionDeclaration).includes("removeAttribute"),
    )
    expect(unmarked).toBeLessThan(methods.indexOf("Input.dispatchKeyEvent"))
    const evaluated = fake.log.find((entry) => entry.method === "Runtime.evaluate")
    expect(String(evaluated?.params.expression)).toContain(`"${FILL_ATTRIBUTE}") === "${MARK}"`)
    expect(
      fake.log.some((entry) =>
        String(entry.params.functionDeclaration).includes("removeAttribute"),
      ),
    ).toBe(true)
    expect(helper.output()).not.toContain("wörd")
    expect(helper.output()).not.toContain("Z9x")
  })

  it("finds the mark in a child frame and reports that frame's origin", async () => {
    const fake = await devtools(model({ iframe: "https://login.example.com" }))
    const helper = run("dsh-browser-fill.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field: "password" })}\n`)
    expect(await helper.line(0)).toEqual({
      located: { origin: "https://login.example.com", element: "input:password" },
    })
    helper.end()
    expect(await helper.line(1)).toEqual({ cancelled: true })
  })

  it("types nothing when the frame went to another origin before the value was entered", async () => {
    const value = model()
    value.onFrameTree = (count) => {
      if (count > 2)
        (value.tabs[0] as { main: { origin: string } }).main.origin = "https://evil.example"
    }
    const fake = await devtools(value)
    const helper = run("dsh-browser-fill.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field: "password" })}\n`)
    await helper.line(0)
    helper.write(fillOrder("https://example.com"))
    helper.write(VALUE_BYTES)
    expect(await helper.line(1)).toEqual({ error: "origin-changed" })
    expect(await helper.exited).toBe(1)
    expect(fake.log.some((entry) => entry.method === "Input.insertText")).toBe(false)
    expect(
      fake.log.some((entry) =>
        String(entry.params.functionDeclaration).includes("removeAttribute"),
      ),
    ).toBe(true)
    expect(helper.output()).not.toContain("Z9x")
  })

  it("refuses an order for another origin than it located", async () => {
    const fake = await devtools(model())
    const helper = run("dsh-browser-fill.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field: "password" })}\n`)
    await helper.line(0)
    helper.write(fillOrder("https://evil.example"))
    helper.write(VALUE_BYTES)
    expect(await helper.line(1)).toEqual({ error: "protocol" })
    expect(fake.log.some((entry) => entry.method === "Input.insertText")).toBe(false)
  })

  it("puts a password only into a password field, and refuses what is not editable", async () => {
    for (const [element, field, code] of [
      [TEXT_INPUT, "password", "not-password-field"],
      [{ ...TEXT_INPUT, disabled: true }, "username", "not-editable"],
      [
        { tag: "div", type: null, editable: false, disabled: false, password: false },
        "otp",
        "not-editable",
      ],
    ] as const) {
      const fake = await devtools(model({ element }))
      const helper = run("dsh-browser-fill.mjs")
      helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field })}\n`)
      expect(await helper.line(0)).toEqual({ error: code })
    }
  })

  it("refuses a mark found twice, none, or in a frame without a web origin", async () => {
    for (const [options, code] of [
      [{ marks: 2 }, "ambiguous"],
      [{ marks: 0 }, "not-found"],
      [{ origin: "null" }, "opaque-origin"],
    ] as const) {
      const fake = await devtools(model(options))
      const helper = run("dsh-browser-fill.mjs")
      helper.write(
        `${JSON.stringify({ devtools: fake.endpoint, mark: MARK, field: "username" })}\n`,
      )
      expect(await helper.line(0)).toEqual({ error: code })
    }
  })

  it("refuses a DevTools endpoint off loopback and a malformed mark", async () => {
    for (const request of [
      { devtools: "10.0.0.1:9222", mark: MARK, field: "username" },
      { devtools: "127.0.0.1:9222", mark: "x", field: "username" },
      { devtools: "127.0.0.1:9222", mark: MARK, field: "passkey" },
    ]) {
      const helper = run("dsh-browser-fill.mjs")
      helper.write(`${JSON.stringify(request)}\n`)
      const line = await helper.line(0)
      expect(["devtools", "protocol"]).toContain(line.error)
    }
  })
})

describe("dsh-browser-passkey", () => {
  const KEY = new Uint8Array(Array.from({ length: 138 }, (_, index) => (index * 7 + 3) & 0xff))
  const order = (origin: string) =>
    `${JSON.stringify({
      passkey: {
        origin,
        rpId: "example.com",
        credentialId: "AQID",
        userHandle: "BAU=",
        signCount: 0,
        seconds: 60,
        length: KEY.length,
      },
    })}\n`

  it("adds a virtual authenticator and the credential to the marked tab until the site used it once", async () => {
    const fake = await devtools(model())
    const helper = run("dsh-browser-passkey.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK })}\n`)
    expect(await helper.line(0)).toEqual({ located: { origin: "https://example.com" } })
    helper.write(order("https://example.com"))
    helper.write(KEY)
    expect(await helper.line(1)).toEqual({ ready: { origin: "https://example.com" } })
    const added = fake.log.find((entry) => entry.method === "WebAuthn.addCredential")
    expect(added?.sessionId).toBe("s-tab-1")
    expect(added?.params).toEqual({
      authenticatorId: "auth-1",
      credential: {
        credentialId: "AQID",
        isResidentCredential: true,
        rpId: "example.com",
        userHandle: "BAU=",
        signCount: 0,
        privateKey: Buffer.from(KEY).toString("base64"),
      },
    })
    const options = fake.log.find((entry) => entry.method === "WebAuthn.addVirtualAuthenticator")
    expect(options?.params).toMatchObject({
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
      },
    })
    const evaluated = fake.log.find((entry) => entry.method === "Runtime.evaluate")
    expect(String(evaluated?.params.expression)).toContain(`"${PASSKEY_ATTRIBUTE}") === "${MARK}"`)
    fake.emit({
      method: "WebAuthn.credentialAsserted",
      sessionId: "s-tab-1",
      params: { authenticatorId: "auth-1" },
    })
    expect(await helper.line(2)).toEqual({ ended: "used" })
    expect(await helper.exited).toBe(0)
    expect(fake.log.some((entry) => entry.method === "WebAuthn.removeVirtualAuthenticator")).toBe(
      true,
    )
    expect(helper.output()).not.toContain(Buffer.from(KEY).toString("base64"))
  })

  it("removes the authenticator when the tab leaves the origin or the Host ends it", async () => {
    const fake = await devtools(model())
    const helper = run("dsh-browser-passkey.mjs")
    helper.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK })}\n`)
    await helper.line(0)
    helper.write(order("https://example.com"))
    helper.write(KEY)
    await helper.line(1)
    fake.emit({
      method: "Page.frameNavigated",
      sessionId: "s-tab-1",
      params: { frame: { id: "main-1", securityOrigin: "https://evil.example" } },
    })
    expect(await helper.line(2)).toEqual({ ended: "navigated" })

    const again = await devtools(model())
    const released = run("dsh-browser-passkey.mjs")
    released.write(`${JSON.stringify({ devtools: again.endpoint, mark: MARK })}\n`)
    await released.line(0)
    released.write(order("https://example.com"))
    released.write(KEY)
    await released.line(1)
    released.end()
    expect(await released.line(2)).toEqual({ ended: "released" })
    expect(again.log.some((entry) => entry.method === "WebAuthn.removeVirtualAuthenticator")).toBe(
      true,
    )
  })

  it("refuses an order for another origin, and is cancelled when the Host refused the passkey", async () => {
    const other = await devtools(model())
    const wrong = run("dsh-browser-passkey.mjs")
    wrong.write(`${JSON.stringify({ devtools: other.endpoint, mark: MARK })}\n`)
    await wrong.line(0)
    wrong.write(order("https://evil.example"))
    wrong.write(KEY)
    expect(await wrong.line(1)).toEqual({ error: "protocol" })
    expect(other.log.some((entry) => entry.method === "WebAuthn.addCredential")).toBe(false)

    const fake = await devtools(model())
    const refused = run("dsh-browser-passkey.mjs")
    refused.write(`${JSON.stringify({ devtools: fake.endpoint, mark: MARK })}\n`)
    await refused.line(0)
    refused.end()
    expect(await refused.line(1)).toEqual({ cancelled: true })
    expect(fake.log.some((entry) => entry.method === "WebAuthn.addVirtualAuthenticator")).toBe(
      false,
    )
  })
})
