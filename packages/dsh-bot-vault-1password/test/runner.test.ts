import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OpFailure } from "../src/op/failure"
import { runOp } from "../src/op/runner"
import { createFakeOp, type FakeOp } from "./support/fake-op"

const env = {
  OP_SERVICE_ACCOUNT_TOKEN: "ops_x",
  HOME: "/nonexistent",
  OP_CONFIG_DIR: "/nonexistent",
  OP_FORMAT: "json",
  OP_CACHE: "false",
}
const command = (args: string[], timeoutMs = 10_000, maxOutputBytes = 1024) => ({
  name: args[0] ?? "",
  args,
  timeoutMs,
  maxOutputBytes,
})

let fake: FakeOp
beforeEach(() => {
  fake = createFakeOp()
})
afterEach(() => {
  fake.remove()
})

const reasonOf = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    if (error instanceof OpFailure) return error.reason
    throw error
  }
  return "resolved"
}

describe("runOp", () => {
  it("returns stdout as bytes", async () => {
    fake.answer("read", { stdout: "abc" })
    const out = await runOp(fake.binary, command(["read"]), env, new AbortController().signal)
    expect(out).toEqual(new TextEncoder().encode("abc"))
    expect(out).not.toBeInstanceOf(Buffer)
  })

  it("stops op after its time", async () => {
    fake.answer("slow", { stdout: "x", delayMs: 10_000 })
    expect(
      await reasonOf(runOp(fake.binary, command(["slow"], 200), env, new AbortController().signal)),
    ).toBe("timeout")
  })

  it("stops op when it prints more than asked for", async () => {
    fake.answer("big", { stdout: "x".repeat(5000) })
    expect(
      await reasonOf(
        runOp(fake.binary, command(["big"], 10_000, 100), env, new AbortController().signal),
      ),
    ).toBe("too-large")
  })

  it("does not start op for an aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await reasonOf(runOp(fake.binary, command(["read"]), env, controller.signal))).toBe(
      "aborted",
    )
    expect(fake.calls()).toEqual([])
  })

  it("fails plainly when op cannot start", async () => {
    expect(
      await reasonOf(
        runOp("/nonexistent/op", command(["read"]), env, new AbortController().signal),
      ),
    ).toBe("failed")
  })

  it.each([
    ["[ERROR] (429) Too Many Requests", "rate-limited"],
    ["[ERROR] (401) Unauthorized", "unauthorized"],
    ["[ERROR] (403) Forbidden", "forbidden"],
    ['[ERROR] "x" isn\'t a vault in this account', "not-found"],
    ["[ERROR] dial tcp: lookup my.1password.com: no such host", "unreachable"],
    ["[ERROR] something new", "failed"],
  ])("classifies %j as %s", async (stderr, reason) => {
    fake.answer("fail", { stderr, code: 1 })
    expect(
      await reasonOf(runOp(fake.binary, command(["fail"]), env, new AbortController().signal)),
    ).toBe(reason)
  })
})
