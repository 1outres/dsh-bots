/**
 * Contract with the real `@deepseek-ai/dsh-ssh` (no mock): the fields the
 * reconnecting front reads exist, and a connection whose `ssh` fails is seen
 * as failed. A stub `ssh` on PATH stands in for OpenSSH.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { SshConnection } from "@deepseek-ai/dsh-ssh"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import BotVmSsh, { assertConnectionShape, connectionFailed } from "../src/plugins/ssh"

const config = {
  host: "dsh-bot-contract",
  launch: { kind: "node-script" as const, node: "/usr/bin/node" },
  helper: "/opt/helper.js",
  helperHash: "a".repeat(64),
  workspace: "/bots/x",
  requestTimeoutMs: 5_000,
  maxFrameBytes: 1024 * 1024,
  maxPending: 8,
  leaseMs: 30_000,
}

let stubDir: string
let path: string | undefined

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "ssh-stub-"))
  const stub = join(stubDir, "ssh")
  writeFileSync(stub, "#!/bin/sh\necho 'stub: connection refused' >&2\nexit 255\n")
  chmodSync(stub, 0o755)
  path = process.env.PATH
  process.env.PATH = `${stubDir}:${path ?? ""}`
})

afterAll(() => {
  process.env.PATH = path
  rmSync(stubDir, { recursive: true, force: true })
})

describe("dsh-ssh contract", () => {
  it("has the failure and closed fields, and sets failure when ssh exits", async () => {
    const root = new Context()
    let connection: SshConnection | undefined
    await root.plugin({
      name: "contract",
      apply: (ctx: Context) => {
        connection = new SshConnection(ctx, config)
      },
    })
    const live = connection as SshConnection
    expect(() => assertConnectionShape(live)).not.toThrow()
    expect(connectionFailed(live)).toBe(false)
    await expect(live.ready).rejects.toThrow()
    expect(connectionFailed(live)).toBe(true)
    await live.dispose()
  })

  it("reports the unreachable VM through the front", async () => {
    const root = new Context()
    await root.plugin(BotVmSsh, config)
    const ssh = root.get("ssh") as unknown as BotVmSsh
    await expect(
      ssh.request("fs.stat", {}, { parse: (value: unknown) => value } as never),
    ).rejects.toThrow("cannot reach the bot VM over SSH (dsh-bot-contract)")
  })

  it("refuses an object without the fields", () => {
    expect(() => assertConnectionShape({})).toThrow("does not support that dsh-ssh version")
  })
})
