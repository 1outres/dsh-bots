import { Context, Service } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import FullAccessSandboxPolicy from "../src/plugins/full-access-policy"

class FakeProjections extends Service {
  registered: string[] = []
  constructor(ctx: Context) {
    super(ctx, "sessionProjections")
  }
  async register(unit: { key: string }) {
    this.registered.push(unit.key)
    return { stateOf: () => "read-only" }
  }
}

async function mount() {
  const root = new Context()
  await root.plugin(FakeProjections)
  await root.plugin(FullAccessSandboxPolicy, { workspaceRoot: "/bots/x" })
  return root.get("sandboxPolicy") as FullAccessSandboxPolicy
}

describe("@1outres/dsh-bot-vm/full-access-policy", () => {
  it("defaults to danger-full-access with the bot directory as root", async () => {
    const policy = await mount()
    expect(policy.defaultMode).toBe("danger-full-access")
    expect(policy.resolve()).toEqual({ mode: "danger-full-access", workspaceRoot: "/bots/x" })
  })

  it("ignores session overrides and explicit modes", async () => {
    const policy = await mount()
    const session = { id: "s1", header: { cwd: "/bots/x/sub" } } as never
    expect(policy.resolve({ session })).toEqual({
      mode: "danger-full-access",
      workspaceRoot: "/bots/x/sub",
      sessionId: "s1",
    })
    expect(policy.resolve({ session, mode: "read-only" }).mode).toBe("danger-full-access")
  })
})
