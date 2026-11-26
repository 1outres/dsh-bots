import { describe, expect, it } from "vitest"
import type { BotEnvironment, BotEnvironmentHost } from "../src/contract"
import { createEnvironmentHostPanel } from "../src/host/environment-host/panel"
import type { EnvironmentHostView } from "../src/shared/environment-host"

const VIEW: EnvironmentHostView = {
  placement: {
    kind: "local",
    socket: "/var/lib/incus/unix.socket",
    project: "dsh-bots",
    chosen: false,
  },
  check: { state: "unchecked" },
  egress: [
    { botId: "a", measure: { state: "isolated", at: 1 } },
    { botId: "gone", measure: { state: "isolated", at: 1 } },
  ],
  released: [],
}

function hostWith(calls: string[]): BotEnvironmentHost {
  const listeners = new Set<() => void>()
  return {
    view: () => VIEW,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    check: async () => VIEW,
    previewToken: (token) => ({ clientName: token, serverFingerprint: "f", urls: [] }),
    async pair(pairing) {
      calls.push(`pair ${pairing.url} ${pairing.project}`)
      return VIEW
    },
    async useLocal(project) {
      calls.push(`local ${project}`)
      return VIEW
    },
    setProject: async () => VIEW,
    forget: async () => VIEW,
  }
}

function setup(host: BotEnvironmentHost | undefined) {
  let environment: BotEnvironment | undefined
  const registrations = new Set<() => void>()
  const bots = new Set<() => void>()
  const panel = createEnvironmentHostPanel({
    environment: {
      current: () => environment,
      onRegistration(listener) {
        registrations.add(listener)
        return () => registrations.delete(listener)
      },
    },
    botName: (botId) => (botId === "a" ? "Ada" : undefined),
    onBots(listener) {
      bots.add(listener)
      return () => bots.delete(listener)
    },
  })
  const register = () => {
    environment = { host } as unknown as BotEnvironment
    for (const listener of registrations) listener()
  }
  return { panel, register, bots }
}

describe("environment host panel", () => {
  it("is none until an environment with a VM host is registered, then follows it", async () => {
    const calls: string[] = []
    const { panel, register, bots } = setup(hostWith(calls))
    expect(panel.state()).toEqual({ status: "none" })
    await expect(panel.check()).rejects.toThrow("no registered bot environment")
    let told = 0
    const off = panel.subscribe(() => told++)
    register()
    expect(told).toBe(1)
    for (const listener of bots) listener()
    expect(told).toBe(2)
    off()
    const state = panel.state()
    expect(state.status === "ready" && state.host.egress).toEqual([
      { botId: "a", botName: "Ada", measure: { state: "isolated", at: 1 } },
    ])
  })

  it("checks what arrives from the browser before the VM host sees it", async () => {
    const calls: string[] = []
    const { panel, register } = setup(hostWith(calls))
    register()
    await expect(panel.pair({ token: "t", url: "", project: "p" })).rejects.toThrow("url is empty")
    await expect(panel.pair("x")).rejects.toThrow("pairing must be an object")
    await expect(panel.useLocal(3)).rejects.toThrow("project must be text")
    expect(() => panel.previewToken("x".repeat(9000))).toThrow("longer than")
    await panel.pair({ token: " t ", url: " https://h:8443 ", project: " p " })
    await panel.useLocal(" bots ")
    expect(calls).toEqual(["pair https://h:8443 p", "local bots"])
    await expect(panel.startImage()).rejects.toThrow("does not import its base image")
  })
})
