import { Context } from "@deepseek-ai/cordis"
import { SshFileSystem } from "@deepseek-ai/dsh-fs-ssh"
import { describe, expect, it } from "vitest"
import BotVmFileSystem from "../src/plugins/fs"

const FULL_ACCESS_POLICY = { mode: "danger-full-access", workspaceRoot: "/home/bot/workspace" }

function mount() {
  const requests: { method: string; params: unknown }[] = []
  const ctx = new Context()
  ctx.provide("ssh", {
    request: async (method: string, params: unknown) => {
      requests.push({ method, params })
      return { version: "v1", created: true }
    },
  })
  ctx.provide("sandboxPolicy", {
    defaultMode: "danger-full-access",
    resolve: () => FULL_ACCESS_POLICY,
  })
  return { fs: new BotVmFileSystem(ctx), requests }
}

describe("@1outres/dsh-bot-vm/fs", () => {
  it("declares that it does not confine, so DSH's file tools offer no sandbox escalation", () => {
    expect(mount().fs.sandboxMode).toBeUndefined()
    expect(BotVmFileSystem.inject).toEqual(SshFileSystem.inject)
  })

  it("still sends the group's full-access policy with a mutation the tools pass no policy for", async () => {
    const { fs, requests } = mount()
    await fs.writeText({ targetKey: "/home/bot/workspace/a.txt" } as never, "text").catch(() => {})
    expect(requests).toEqual([
      {
        method: "fs.write",
        params: expect.objectContaining({ policy: FULL_ACCESS_POLICY }),
      },
    ])
  })
})
