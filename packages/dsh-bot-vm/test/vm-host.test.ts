import type { BotEnvironmentImageHost, BotEnvironmentImageView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import type {
  ClientKeyStore,
  EndpointStore,
  IncusEndpoint,
  StoredScope,
} from "../src/host/endpoint"
import { createEndpointScope } from "../src/host/endpoint-scope"
import type { IncusClient } from "../src/host/incus"
import { switchableIncusClient } from "../src/host/switchable-incus"
import { createVmHost } from "../src/host/vm-host"
import { certificateFingerprint, createSelfSignedIdentity } from "../src/node/client-identity"
import { incusWith } from "./support/incus"

const SERVER = "ab".repeat(32)
const PROJECT_CONFIG = {
  restricted: "true",
  "user.dsh-bots.pool": "dsh",
  "user.dsh-bots.network": "dshbr0",
  "user.dsh-bots.egress-acl": "dsh-bot-egress",
}

const tokenText = (expires = "0001-01-01T00:00:00Z") =>
  Buffer.from(
    JSON.stringify({
      client_name: "dsh-bots-test",
      fingerprint: SERVER,
      addresses: ["vm-host:8443"],
      secret: "s".repeat(64),
      expires_at: expires,
    }),
  ).toString("base64")

function healthy(project: string, calls: string[]): IncusClient {
  return incusWith({
    server: async () => ({
      auth: "trusted",
      apiExtensions: [],
      serverVersion: "6.0.4",
      drivers: ["qemu"],
    }),
    projectConfig: async () => {
      calls.push(`project ${project}`)
      if (project === "missing") throw new Error("Project not found")
      return PROJECT_CONFIG
    },
    poolSpace: async () => 1024 ** 4,
    hasNetwork: async (name) => name === "dshbr0",
    profiles: async () => [],
    trustWithToken: async (token) => {
      calls.push(`trust ${token.length}`)
    },
  })
}

function fakeImage(): BotEnvironmentImageHost & { readonly calls: string[] } {
  const calls: string[] = []
  let view: BotEnvironmentImageView = {
    alias: "dsh-bot-base",
    managed: true,
    status: {
      kind: "importing",
      progress: { step: "download", doneBytes: 1, totalBytes: 2 },
      since: 0,
    },
  }
  return {
    calls,
    view: () => view,
    subscribe: () => () => {},
    async refresh() {
      calls.push("refresh")
      return view
    },
    start: () => view,
    cancel() {
      calls.push("cancel")
      view = { ...view, status: { kind: "missing" } }
      return view
    },
  }
}

function setup(options: { unreadable?: boolean } = {}) {
  let stored: StoredScope | undefined
  let key: string | undefined
  const calls: string[] = []
  const store: EndpointStore = {
    async read() {
      if (options.unreadable === true) throw new Error("bad version")
      return stored
    },
    async write(scope) {
      stored = scope
    },
    async clear() {
      stored = undefined
    },
  }
  const keys: ClientKeyStore = {
    read: async () => key,
    async write(next) {
      key = next
    },
    async clear() {
      calls.push("key cleared")
      key = undefined
    },
  }
  const scope = createEndpointScope({
    store,
    keys,
    defaults: {
      endpoint: { kind: "local", socket: "/var/lib/incus/unix.socket" },
      project: "dsh-bots",
    },
    connect: (endpoint: IncusEndpoint, project: string) => {
      calls.push(`connect ${endpoint.kind} ${project}`)
      return { incus: healthy(project, calls), close: () => calls.push(`close ${project}`) }
    },
  })
  const image = fakeImage()
  let rehomed = 0
  const host = createVmHost({
    scope,
    image,
    rehome: () => {
      rehomed++
    },
    pairing: {
      createIdentity: async (commonName) =>
        createSelfSignedIdentity({ commonName, now: new Date(), usage: "client" }),
      connect: () => ({ incus: healthy("(server)", calls), close() {} }),
      now: () => 0,
    },
    clientName: "dsh-bots@test",
    fingerprintOf: certificateFingerprint,
    now: () => 1_000,
    log: () => {},
  })
  return { host, scope, image, calls, stored: () => stored, key: () => key, rehomed: () => rehomed }
}

describe("VM host", () => {
  it("is this machine with the configured project until one is chosen, and checks it", async () => {
    const { host } = setup()
    expect(host.view().placement).toEqual({ kind: "reading" })
    const view = await host.check()
    expect(view.placement).toEqual({
      kind: "local",
      socket: "/var/lib/incus/unix.socket",
      project: "dsh-bots",
      chosen: false,
    })
    expect(view.check).toEqual({
      state: "ready",
      at: 1_000,
      declaration: { pool: "dsh", network: "dshbr0", egressAcl: "dsh-bot-egress" },
    })
  })

  it("moves to another project: stored, reconnected there, the bots ensured again", async () => {
    const t = setup()
    await t.host.check()
    const view = await t.host.useLocal(" bots-2 ")
    expect(t.stored()?.project).toBe("bots-2")
    expect(t.scope.project()).toBe("bots-2")
    expect(view.placement).toMatchObject({ kind: "local", project: "bots-2", chosen: true })
    expect(t.calls).toContain("close dsh-bots")
    expect(t.calls).toContain("connect local bots-2")
    expect(t.rehomed()).toBe(1)
    expect(t.image.calls).toEqual(["cancel", "refresh"])
    await expect(t.host.useLocal("default")).rejects.toThrow('"default"')
    const missing = await t.host.setProject("missing")
    expect(missing.check).toMatchObject({
      state: "failed",
      problems: [{ code: "project-missing" }],
    })
  })

  it("pairs with a VM host, and on leaving it tells what to run there", async () => {
    const t = setup()
    const preview = t.host.previewToken(tokenText())
    expect(preview).toEqual({
      clientName: "dsh-bots-test",
      serverFingerprint: SERVER,
      urls: ["https://vm-host:8443"],
    })
    const paired = await t.host.pair({
      token: tokenText(),
      url: "https://vm-host:8443",
      project: "dsh-bots",
    })
    expect(t.calls).toContain(`trust ${tokenText().length}`)
    expect(t.key()).toContain("PRIVATE KEY")
    const stored = t.stored()
    if (stored?.endpoint.kind !== "remote") throw new Error("not paired")
    const fingerprint = certificateFingerprint(stored.endpoint.clientCertificate)
    expect(paired.placement).toEqual({
      kind: "remote",
      url: "https://vm-host:8443",
      project: "dsh-bots",
      serverFingerprint: SERVER,
      clientFingerprint: fingerprint,
    })
    expect(t.calls).toContain("connect remote dsh-bots")
    const left = await t.host.forget()
    expect(left.placement).toMatchObject({ kind: "local", chosen: false })
    expect(left.released).toEqual([
      {
        url: "https://vm-host:8443",
        clientFingerprint: fingerprint,
        command: `incus config trust remove ${fingerprint.slice(0, 12)}`,
      },
    ])
    expect(t.key()).toBeUndefined()
    expect(t.rehomed()).toBe(2)
  })

  it("refuses an expired token before anything is sent", async () => {
    const t = setup()
    await expect(
      t.host.pair({
        token: tokenText("1970-01-01T00:00:00Z"),
        url: "https://vm-host:8443",
        project: "dsh-bots",
      }),
    ).rejects.toThrow("expired")
    expect(t.calls.filter((call) => call.startsWith("trust"))).toEqual([])
    expect(t.stored()).toBeUndefined()
  })

  it("shows a stored choice it cannot read as the problem to fix", async () => {
    const { host } = setup({ unreadable: true })
    const view = await host.check()
    expect(view.placement).toMatchObject({
      kind: "unreadable",
      problem: { code: "stored-unreadable" },
    })
    expect(view.check).toMatchObject({ state: "failed", problems: [{ code: "stored-unreadable" }] })
  })

  it("keeps each bot's latest egress measure, and forgets them on a change of VM host", async () => {
    const t = setup()
    t.host.egress("a", { state: "open", at: 5, gateway: "10.0.0.1", reached: ["10.0.0.1:22"] })
    t.host.egress("b", { state: "isolated", at: 6, gateway: "10.0.0.1" })
    expect(t.host.view().egress).toEqual([
      { botId: "a", measure: { state: "open", at: 5, reached: ["10.0.0.1:22"] } },
      { botId: "b", measure: { state: "isolated", at: 6 } },
    ])
    await t.host.useLocal("bots-2")
    expect(t.host.view().egress).toEqual([])
  })
})

describe("switchable Incus client", () => {
  it("sends every call to the client chosen at that moment", async () => {
    const only = (alias: IncusClient["alias"]) => ({ alias }) as unknown as IncusClient
    let current = only(async () => "first")
    const incus = switchableIncusClient(async () => current)
    expect(await incus.alias("x")).toBe("first")
    current = only(async (name) => `second ${name}`)
    expect(await incus.alias("x")).toBe("second x")
  })
})
