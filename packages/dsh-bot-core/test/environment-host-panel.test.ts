import { describe, expect, it } from "vitest"
import type { BotEnvironment, BotEnvironmentHost } from "../src/contract"
import { createEnvironmentHostPanel } from "../src/host/environment-host/panel"
import type { EnvironmentHostView } from "../src/shared/environment-host"

const VIEW: EnvironmentHostView = {
  placement: { kind: "none" },
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
    setup: new Proxy({} as BotEnvironmentHost["setup"], {
      get: () => () => {
        throw new Error("not used here")
      },
    }),
    custom: {
      async preview(credential) {
        if (credential.backend !== "incus") throw new Error("incus only")
        return {
          backend: "incus",
          clientName: credential.trustToken,
          serverFingerprint: "f",
          urls: [],
        }
      },
      async connect(request) {
        calls.push(
          request.backend === "incus"
            ? `incus ${request.url} ${request.project}`
            : `proxmox ${request.url} ${request.node} ${request.pool}`,
        )
        return VIEW
      },
    },
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
    pluginVersion: "1.2.3",
    botName: (botId) => (botId === "a" ? "Ada" : undefined),
    onBots(listener) {
      bots.add(listener)
      return () => bots.delete(listener)
    },
    investigate: async () => ({ sessionId: "s" }),
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
    await expect(
      panel.connectCustom({ backend: "incus", token: "t", url: "", project: "p" }),
    ).rejects.toThrow("url is empty")
    await expect(panel.connectCustom("x")).rejects.toThrow("request must be an object")
    await expect(panel.connectCustom({ backend: "lxd" })).rejects.toThrow("incus or proxmox")
    await expect(
      panel.connectCustom({ backend: "incus", token: "t", url: "https://h", project: 3 }),
    ).rejects.toThrow("project must be text")
    await expect(
      panel.previewCustom({ backend: "incus", trustToken: "x".repeat(9000) }),
    ).rejects.toThrow("longer than")
    await expect(
      panel.previewCustom({ backend: "incus", trustToken: " t " }),
    ).resolves.toMatchObject({
      clientName: "t",
    })
    await expect(
      panel.connectCustom({
        backend: "proxmox",
        url: "https://pve:8006",
        tokenId: "u@pve!t",
        tokenSecret: "s",
        serverFingerprint: "f",
        node: "n1",
        pool: "bots",
        storage: "dshbots",
        bridge: "vmbr0",
        sshSource: "10.0.0.2",
        nameservers: [],
      }),
    ).rejects.toThrow("nameservers is empty")
    await panel.connectCustom({
      backend: "incus",
      token: " t ",
      url: " https://h:8443 ",
      project: " p ",
    })
    await panel.connectCustom({
      backend: "proxmox",
      url: "https://pve:8006",
      tokenId: "u@pve!t",
      tokenSecret: "s",
      serverFingerprint: "f",
      node: "n1",
      pool: "bots",
      storage: " dshbots ",
      bridge: "vmbr0",
      sshSource: "10.0.0.2",
      nameservers: [" 1.1.1.1 "],
    })
    expect(calls).toEqual(["incus https://h:8443 p", "proxmox https://pve:8006 n1 bots"])
    await expect(panel.startImage()).rejects.toThrow("does not import its base image")
  })
})
