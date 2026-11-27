import type { BotEnvironmentImageHost, BotEnvironmentImageView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import type { VmBackend } from "../src/host/backend/contract"
import { createIncusBackend } from "../src/host/backend/incus/backend"
import type { IncusClient } from "../src/host/backend/incus/client"
import type { StoredPlacement } from "../src/host/placement/placement"
import { createPlacementScope } from "../src/host/placement/scope"
import type { SecretStore } from "../src/host/placement/secrets"
import type { PlacementReading, PlacementStore } from "../src/host/placement/store"
import type { ManagedSetup, SetupHost } from "../src/host/setup/setup"
import { createVmHost } from "../src/host/vm-host"
import { hostKeyFingerprint } from "../src/index"
import { certificateFingerprint, createSelfSignedIdentity } from "../src/node/client-identity"
import { pinnedHostKey } from "../src/node/ssh-tools"
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

function proxmoxStub(layout: {
  readonly node: string
  readonly pool: string
  readonly storage: string
  readonly bridge: string
}): VmBackend {
  const unused = () => {
    throw new Error("unused")
  }
  const none = new Proxy({}, { get: () => unused })
  return {
    kind: "proxmox",
    where: `the Proxmox pool "${layout.pool}"`,
    workspaceDevice: "/dev/disk/by-id/virtio-dsh-workspace",
    check: async () => ({
      ok: true,
      declaration: { kind: "proxmox", ...layout, limits: { cpus: 4, memoryMiB: 8192 } },
    }),
    capacity: unused,
    instances: none as VmBackend["instances"],
    workspaces: none as VmBackend["workspaces"],
    images: none as VmBackend["images"],
    guest: { sshd: "listening", open: unused },
  }
}

function idleSetup(): ManagedSetup {
  const unused = () => {
    throw new Error("unused")
  }
  return {
    view: () => undefined,
    load: async () => {},
    close: () => {},
    identity: unused,
    removeIdentity: unused,
    scanHostKey: unused,
    inspect: unused,
    start: unused,
    cancel: unused,
    dismiss: unused,
    brief: unused,
  }
}

function setup(options: { reading?: PlacementReading; unreadable?: boolean } = {}) {
  let reading: PlacementReading = options.reading ?? { kind: "none" }
  let key: string | undefined
  let tokenSecret: string | undefined
  const calls: string[] = []
  const store: PlacementStore = {
    async read() {
      if (options.unreadable === true) throw new Error("bad version")
      return reading
    },
    async write(placement) {
      reading = { kind: "placed", placement }
    },
    async clear() {
      reading = { kind: "none" }
    },
  }
  const tokens: SecretStore = {
    read: async () => tokenSecret,
    async write(next) {
      tokenSecret = next
    },
    async clear() {
      tokenSecret = undefined
    },
  }
  const keys: SecretStore = {
    read: async () => key,
    async write(next) {
      key = next
    },
    async clear() {
      calls.push("key cleared")
      key = undefined
    },
  }
  const scope = createPlacementScope({
    store,
    secretOf: (kind) => (kind === "incus" ? keys : tokens),
    placeOf: ({ backend }) => (backend.kind === "incus" ? backend.project : backend.pool),
    connect: (placement: StoredPlacement) => {
      if (placement.backend.kind === "proxmox") {
        const { url, node, pool, storage, bridge } = placement.backend
        calls.push(`connect ${url} ${pool}`)
        return {
          backend: proxmoxStub({ node, pool, storage, bridge }),
          close: () => calls.push(`close ${pool}`),
        }
      }
      const { project } = placement.backend
      calls.push(`connect ${placement.backend.url} ${project}`)
      return {
        backend: createIncusBackend({
          incus: healthy(project, calls),
          project,
          origin: placement.origin.kind,
          uploadTimeoutMs: 1,
        }),
        close: () => calls.push(`close ${project}`),
      }
    },
  })
  const image = fakeImage()
  const hosts: SetupHost[] = []
  let rehomed = 0
  const host = createVmHost({
    scope,
    proxmox: {
      probe: async (url) => {
        calls.push(`probe ${url}`)
        return { serverCertificateSha256: SERVER, sourceAddress: "10.0.0.2" }
      },
      verify: async (backend, secret) => {
        calls.push(`verify ${backend.tokenId} ${secret}`)
        if (secret === "rejected-secret") throw new Error("401 authentication failure")
      },
    },
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
    pinHostKey: pinnedHostKey,
    setup: (setupHost) => {
      hosts.push(setupHost)
      return idleSetup()
    },
    setupUpdate: (setup) => (setup.bundleSha256 === "c".repeat(64) ? "current" : "available"),
    now: () => 1_000,
    log: () => {},
  })
  const setKey = (next: string | undefined) => {
    key = next
  }
  return {
    host,
    scope,
    image,
    calls,
    reading: () => reading,
    key: () => key,
    tokenSecret: () => tokenSecret,
    setKey,
    rehomed: () => rehomed,
    setupHost: () => hosts[0] as SetupHost,
  }
}

const connectRequest = (token = tokenText()) => ({
  backend: "incus" as const,
  token,
  url: "https://vm-host:8443",
  project: "dsh-bots",
})

const HOST_KEY = `ssh-ed25519 ${Buffer.from("host key bytes").toString("base64")}`

describe("VM host", () => {
  it("is nothing until a VM host is chosen, and says so in the check", async () => {
    const { host } = setup()
    expect(host.view().placement).toEqual({ kind: "reading" })
    const view = await host.check()
    expect(view.placement).toEqual({ kind: "none" })
    expect(view.check).toMatchObject({
      state: "failed",
      problems: [{ scope: "placement", code: "placement-none", fix: { kind: "choose-host" } }],
    })
  })

  it("asks for the move of this machine's socket and never connects to it", async () => {
    const t = setup({
      reading: {
        kind: "migration-required",
        from: { socket: "/var/lib/incus/unix.socket", project: "dsh-bots" },
      },
    })
    const view = await t.host.check()
    expect(view.placement).toEqual({
      kind: "migration-required",
      from: { kind: "incus-socket", socket: "/var/lib/incus/unix.socket", project: "dsh-bots" },
    })
    expect(view.check).toMatchObject({ problems: [{ code: "migration-required" }] })
    expect(t.calls.filter((call) => call.startsWith("connect"))).toEqual([])
  })

  it("connects to an existing Incus server, and on leaving it tells what to run there", async () => {
    const t = setup()
    const preview = await t.host.custom.preview({ backend: "incus", trustToken: tokenText() })
    expect(preview).toEqual({
      backend: "incus",
      clientName: "dsh-bots-test",
      serverFingerprint: SERVER,
      urls: ["https://vm-host:8443"],
    })
    const paired = await t.host.custom.connect(connectRequest())
    expect(t.calls).toContain(`trust ${tokenText().length}`)
    expect(t.key()).toContain("PRIVATE KEY")
    const stored = t.reading()
    if (stored.kind !== "placed" || stored.placement.backend.kind !== "incus") {
      throw new Error("not placed")
    }
    expect(stored.placement.origin).toEqual({ kind: "custom" })
    const fingerprint = certificateFingerprint(stored.placement.backend.clientCertificate)
    expect(paired.placement).toEqual({
      kind: "placed",
      backend: {
        kind: "incus",
        url: "https://vm-host:8443",
        project: "dsh-bots",
        serverFingerprint: SERVER,
        clientFingerprint: fingerprint,
      },
      origin: { kind: "custom" },
    })
    expect(paired.check).toEqual({
      state: "ready",
      at: 1_000,
      declaration: { kind: "incus", pool: "dsh", network: "dshbr0", egressAcl: "dsh-bot-egress" },
    })
    expect(t.calls).toContain("connect https://vm-host:8443 dsh-bots")
    expect(t.image.calls).toEqual(["cancel", "refresh"])
    const left = await t.host.forget()
    expect(left.placement).toEqual({ kind: "none" })
    expect(left.released).toEqual([
      {
        url: "https://vm-host:8443",
        clientFingerprint: fingerprint,
        command: `incus config trust remove ${fingerprint.slice(0, 12)}`,
      },
    ])
    expect(t.calls).toContain("close dsh-bots")
    expect(t.key()).toBeUndefined()
    expect(t.rehomed()).toBe(2)
  })

  it("refuses an expired token before anything is sent, and the default project", async () => {
    const t = setup()
    await expect(
      t.host.custom.connect(connectRequest(tokenText("1970-01-01T00:00:00Z"))),
    ).rejects.toThrow("expired")
    await expect(
      t.host.custom.connect({ ...connectRequest(), project: "default" }),
    ).rejects.toThrow('"default"')
    expect(t.calls.filter((call) => call.startsWith("trust"))).toEqual([])
    expect(t.reading()).toEqual({ kind: "none" })
  })

  it("connects to Proxmox VE with an API token kept as a secret, after the token answers", async () => {
    const t = setup()
    await expect(
      t.host.custom.preview({ backend: "proxmox", url: "https://pve" }),
    ).resolves.toEqual({
      backend: "proxmox",
      url: "https://pve:8006",
      serverFingerprint: SERVER,
      sourceAddress: "10.0.0.2",
    })
    const request = {
      backend: "proxmox" as const,
      url: "https://pve:8006",
      tokenId: "dsh-bots@pve!plugin",
      tokenSecret: "rejected-secret",
      serverFingerprint: SERVER.toUpperCase().match(/../g)?.join(":") ?? "",
      node: "pve1",
      pool: "dsh-bots",
      storage: "dshbots",
      bridge: "vmbr0",
      sshSource: "10.0.0.2",
      nameservers: ["1.1.1.1"],
    }
    await expect(t.host.custom.connect(request)).rejects.toThrow("401")
    expect(t.reading()).toEqual({ kind: "none" })
    await expect(t.host.custom.connect({ ...request, nameservers: ["dns"] })).rejects.toThrow(
      "IPv4",
    )
    const placed = await t.host.custom.connect({ ...request, tokenSecret: "0123-abcd-secret" })
    expect(t.tokenSecret()).toBe("0123-abcd-secret")
    expect(placed.placement).toEqual({
      kind: "placed",
      backend: {
        kind: "proxmox",
        url: "https://pve:8006",
        node: "pve1",
        pool: "dsh-bots",
        storage: "dshbots",
        bridge: "vmbr0",
        tokenId: "dsh-bots@pve!plugin",
        serverFingerprint: SERVER,
        sshSource: "10.0.0.2",
        nameservers: ["1.1.1.1"],
      },
      origin: { kind: "custom" },
    })
    expect(placed.check).toMatchObject({
      state: "ready",
      declaration: { kind: "proxmox", pool: "dsh-bots" },
    })
    expect(JSON.stringify(t.reading())).not.toContain("0123-abcd-secret")
    await t.host.forget()
    expect(t.tokenSecret()).toBeUndefined()
    expect(t.calls).toContain("close dsh-bots")
  })

  it("shows a VM host dsh-bots built with its site, and whether its setup is current", async () => {
    const t = setup({
      reading: {
        kind: "placed",
        placement: {
          version: 3,
          backend: {
            kind: "incus",
            url: "https://vm-host:8443",
            serverCertificateSha256: SERVER,
            clientCertificate: createSelfSignedIdentity({
              commonName: "c",
              now: new Date(),
              usage: "client",
            }).certificate,
            project: "dsh-bots",
          },
          origin: {
            kind: "managed",
            site: {
              kind: "ssh",
              host: "vm-host",
              port: 22,
              user: "admin",
              hostKey: HOST_KEY,
              identity: "kept",
            },
            setup: { jobId: "j", completedAt: 7, bundleSha256: "d".repeat(64) },
          },
        },
      },
    })
    t.setKey("key")
    const view = await t.host.check()
    expect(view.placement).toMatchObject({
      kind: "placed",
      origin: {
        kind: "managed",
        site: {
          kind: "ssh",
          host: "vm-host",
          port: 22,
          user: "admin",
          hostKey: { type: "ssh-ed25519", fingerprint: hostKeyFingerprint(HOST_KEY) },
          identity: "kept",
        },
        completedAt: 7,
        update: "available",
      },
    })
    expect(hostKeyFingerprint(HOST_KEY)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it("reports a missing key as its own problem", async () => {
    const t = setup()
    await t.host.custom.connect(connectRequest())
    t.setKey(undefined)
    t.scope.close()
    const view = await t.host.check()
    expect(view.check).toMatchObject({ problems: [{ code: "secret-missing" }] })
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
    await t.host.custom.connect(connectRequest())
    expect(t.host.view().egress).toEqual([])
  })
})
