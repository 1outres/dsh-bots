import { describe, expect, it } from "vitest"
import { type StoredPlacement, serializePlacement } from "../src/host/placement/placement"
import { readStoredPlacement } from "../src/host/placement/placement-migration"
import { filePlacementStore, type StoreFiles } from "../src/host/placement/store"
import { createSelfSignedIdentity } from "../src/node/client-identity"

const SERVER = "ab".repeat(32)
const certificate = createSelfSignedIdentity({
  commonName: "dsh-bots@test",
  now: new Date(),
  usage: "client",
}).certificate

const v2 = (endpoint: unknown, project = "dsh-bots") =>
  JSON.stringify({ version: 2, project, endpoint })

const REMOTE = {
  kind: "remote",
  url: "https://h:8443/",
  serverCertificateSha256: `${"AB:".repeat(31)}AB`,
  clientCertificate: certificate,
}

const PLACED: StoredPlacement = {
  version: 3,
  backend: {
    kind: "incus",
    url: "https://h:8443",
    serverCertificateSha256: SERVER,
    clientCertificate: certificate,
    project: "dsh-bots",
  },
  origin: { kind: "custom" },
}

function memoryFiles() {
  const files = new Map<string, { content: string; mode: number }>()
  const api: StoreFiles = {
    read: async (path) => files.get(path)?.content,
    write: async (path, content, mode) => void files.set(path, { content, mode }),
    async rename(from, to) {
      const found = files.get(from)
      if (found === undefined) throw new Error(`no ${from}`)
      files.set(to, found)
      files.delete(from)
    },
    remove: async (path) => void files.delete(path),
  }
  return { files, api }
}

describe("stored placement", () => {
  it("reads version 3 back as it was written", () => {
    expect(readStoredPlacement(serializePlacement(PLACED))).toEqual({
      kind: "current",
      placement: PLACED,
    })
    const managed: StoredPlacement = {
      ...PLACED,
      origin: {
        kind: "managed",
        site: {
          kind: "ssh",
          host: "vm-host",
          port: 22,
          user: "root",
          hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA==",
          identity: "removed",
        },
        setup: { jobId: "j1", completedAt: 5, bundleSha256: "c".repeat(64) },
      },
    }
    expect(readStoredPlacement(serializePlacement(managed))).toEqual({
      kind: "current",
      placement: managed,
    })
  })

  it("rejects what it did not write", () => {
    expect(() => readStoredPlacement("{")).toThrow("not JSON")
    expect(() => readStoredPlacement("{}")).toThrow("unknown version")
    expect(() => readStoredPlacement(JSON.stringify({ version: 1 }))).toThrow(
      "choose the VM host again",
    )
    const record = JSON.parse(serializePlacement(PLACED))
    expect(() =>
      readStoredPlacement(
        JSON.stringify({ ...record, backend: { ...record.backend, url: "http://h" } }),
      ),
    ).toThrow("https://")
    expect(() =>
      readStoredPlacement(
        JSON.stringify({ ...record, backend: { ...record.backend, project: "default" } }),
      ),
    ).toThrow('"default"')
    expect(() =>
      readStoredPlacement(
        JSON.stringify({
          ...record,
          backend: {
            kind: "proxmox",
            url: "https://pve:8006",
            serverCertificateSha256: SERVER,
            tokenId: "t",
            node: "n",
            pool: "p",
          },
          origin: { kind: "managed", site: { kind: "this-machine" }, setup: {} },
        }),
      ),
    ).toThrow()
    expect(() =>
      readStoredPlacement(JSON.stringify({ ...record, origin: { kind: "elsewhere" } })),
    ).toThrow("unknown kind")
  })

  it("turns a version 2 remote into a custom Incus placement without losing anything", () => {
    expect(readStoredPlacement(v2(REMOTE))).toEqual({ kind: "migrated", placement: PLACED })
  })

  it("never connects a version 2 local socket: it is a move to make", () => {
    expect(
      readStoredPlacement(v2({ kind: "local", socket: "/var/lib/incus/unix.socket" })),
    ).toEqual({
      kind: "legacy-socket",
      from: { socket: "/var/lib/incus/unix.socket", project: "dsh-bots" },
    })
    expect(() => readStoredPlacement(v2({ kind: "local", socket: "relative" }))).toThrow("absolute")
  })
})

describe("placement store", () => {
  it("is none without a file, writes version 3 alone and 0600", async () => {
    const { files, api } = memoryFiles()
    const store = filePlacementStore("/state", api, () => {})
    await expect(store.read()).resolves.toEqual({ kind: "none" })
    await store.write(PLACED)
    expect(files.get("/state/endpoint.json")?.mode).toBe(0o600)
    expect(files.get("/state/endpoint.json")?.content).not.toContain("PRIVATE KEY")
    await expect(store.read()).resolves.toEqual({ kind: "placed", placement: PLACED })
    expect(files.has("/state/endpoint.v2.json")).toBe(false)
    await store.clear()
    await expect(store.read()).resolves.toEqual({ kind: "none" })
  })

  it("moves a version 2 remote to version 3 once, keeping the earlier file", async () => {
    const { files, api } = memoryFiles()
    const logs: string[] = []
    files.set("/state/endpoint.json", { content: v2(REMOTE), mode: 0o600 })
    const store = filePlacementStore("/state", api, (message) => logs.push(message))
    await expect(store.read()).resolves.toEqual({ kind: "placed", placement: PLACED })
    expect(files.get("/state/endpoint.v2.json")?.content).toBe(v2(REMOTE))
    expect(JSON.parse(files.get("/state/endpoint.json")?.content ?? "")).toMatchObject({
      version: 3,
    })
    await store.read()
    expect(logs).toHaveLength(1)
  })

  it("keeps a version 2 local file until another placement replaces it", async () => {
    const { files, api } = memoryFiles()
    const local = v2({ kind: "local", socket: "/var/lib/incus/unix.socket" })
    files.set("/state/endpoint.json", { content: local, mode: 0o600 })
    const store = filePlacementStore("/state", api, () => {})
    await expect(store.read()).resolves.toMatchObject({ kind: "migration-required" })
    expect(files.get("/state/endpoint.json")?.content).toBe(local)
    await store.write(PLACED)
    expect(files.get("/state/endpoint.v2.json")?.content).toBe(local)
    await expect(store.read()).resolves.toEqual({ kind: "placed", placement: PLACED })
  })
})
