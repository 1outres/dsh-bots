import { type BotVaultAccess, type CredentialTarget, SecretBytes } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { AgentCallError } from "../src/host/agent/rpc"
import { execute, fakeAgent, runOf, session, toolsWith, WHERE } from "./support"

const VALUE = "correct horse battery"
const TOKEN = "0123456789abcdef0123456789abcdef"

function fakeVault(refusal?: string) {
  const reveals: { handle: string; field: string; target: CredentialTarget }[] = []
  const handed: SecretBytes[] = []
  const vault: BotVaultAccess = {
    async describe(handle) {
      if (handle !== "cred-1") throw new Error("not one of this bot's credentials")
      return {
        handle,
        label: "Mail",
        sites: [],
        kinds: ["username", "password"],
        desktop: true,
      }
    },
    async reveal(handle, field, target) {
      reveals.push({ handle, field, target })
      if (refusal !== undefined) throw new Error(refusal)
      const secret = SecretBytes.from(new TextEncoder().encode(VALUE))
      handed.push(secret)
      return secret
    },
    async passkey() {
      throw new Error("no passkey")
    },
  }
  return { vault, reveals, handed }
}

const TARGET = () => ({
  token: TOKEN,
  application: "zenity",
  role: "password text",
  name: "Password",
})

function setup(answers: Parameters<typeof fakeAgent>[0], refusal?: string) {
  const agent = fakeAgent(answers)
  const vault = fakeVault(refusal)
  const run = { ...runOf(session(agent.agent)), vault: vault.vault }
  return { ...agent, ...vault, run, tool: toolsWith().byName("type_credential") }
}

describe("desktop_type_credential", () => {
  it("is allowed, serialized on the display and the only tool that reaches the logins", () => {
    const { list, byName } = toolsWith()
    expect(list.filter((tool) => tool.vault === true).map((tool) => tool.name)).toEqual([
      "type_credential",
    ])
    expect(byName("type_credential").permission).toBe("allow")
    expect(byName("type_credential").exclusive).toBe("display")
  })

  it("checks the field, reveals for its application, and types it without returning the value", async () => {
    const t = setup({
      secret_target: TARGET,
      type_secret: () => ({ application: "zenity", ...WHERE }),
    })
    const result = await execute(
      t.tool,
      { credential: "cred-1", field: "password", element: "3:9", submit: true },
      t.run,
    )
    expect(t.calls).toEqual([
      { method: "secret_target", params: { field: "password", element: "3:9" } },
      { method: "type_secret", params: { token: TOKEN, submit: true } },
    ])
    expect(t.reveals).toEqual([
      {
        handle: "cred-1",
        field: "password",
        target: { kind: "desktop", application: "zenity" },
      },
    ])
    expect(new TextDecoder().decode(t.secrets[0])).toBe(VALUE)
    expect(t.handed.every((secret) => secret.spent)).toBe(true)
    expect(result.text).toBe(
      'Typed the password of "Mail" into zenity (password text "Password"), then pressed Return. The value is not shown to you, by design.',
    )
    expect(JSON.stringify(result)).not.toContain(VALUE)
  })

  it("types nothing when bot-core refuses the login", async () => {
    const t = setup(
      { secret_target: TARGET },
      'the owner did not allow "Mail" in desktop applications',
    )
    await expect(
      execute(t.tool, { credential: "cred-1", field: "password" }, t.run),
    ).rejects.toThrow(/did not allow "Mail" in desktop applications/)
    expect(t.calls.map((call) => call.method)).toEqual(["secret_target"])
  })

  it("asks for no value when the agent refuses the field (a browser, not a password field)", async () => {
    const t = setup({
      secret_target: new AgentCallError("browser_refused", "Google Chrome is a web browser"),
    })
    await expect(
      execute(t.tool, { credential: "cred-1", field: "password" }, t.run),
    ).rejects.toThrow(/^browser_refused: Google Chrome is a web browser/)
    expect(t.reveals).toEqual([])
  })

  it("touches nothing for a handle that is not the bot's or a malformed element", async () => {
    const t = setup({ secret_target: TARGET })
    await expect(
      execute(t.tool, { credential: "cred-2", field: "username" }, t.run),
    ).rejects.toThrow(/not one of this bot's credentials/)
    await expect(
      execute(t.tool, { credential: "cred-1", field: "username", element: "x" }, t.run),
    ).rejects.toThrow(/not an element id/)
    expect(t.calls).toEqual([])
    expect(t.reveals).toEqual([])
  })

  it("is refused while a person operates the desktop", async () => {
    const t = setup({ secret_target: TARGET })
    const { byName, control } = toolsWith()
    control.connected("b1")
    control.take("b1", Symbol("viewer"))
    await expect(
      execute(byName("type_credential"), { credential: "cred-1", field: "otp" }, t.run),
    ).rejects.toThrow(/^USER_IN_CONTROL/)
    expect(t.reveals).toEqual([])
  })
})
