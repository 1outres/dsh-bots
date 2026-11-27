import { createHash } from "node:crypto"
import { zstdCompressSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { GuestChannel, VmBackend } from "../src/host/backend/contract"
import { createProxmoxBackend } from "../src/host/backend/proxmox/backend"
import { createProxmoxClient } from "../src/host/backend/proxmox/client"
import type { ProxmoxLayout } from "../src/host/backend/proxmox/endpoint"
import { blockedIpv4 } from "../src/host/backend/proxmox/firewall"
import { metaOf } from "../src/host/backend/proxmox/meta"
import { isoOf } from "../src/host/backend/proxmox/seed"
import { unpackImage } from "../src/node/image-unpack"
import { createProxmoxTransport, probeProxmox } from "../src/node/proxmox-transport"
import { tarOf } from "../src/node/tar"
import { type FakeProxmox, startFakeProxmox } from "./support/fake-proxmox-server"

const OWNER = "0123456789abcdef0123456789abcdef"
const GIB = 1024 ** 3
const LAYOUT: ProxmoxLayout = {
  node: "pve1",
  pool: "dsh-bots",
  storage: "dshbots",
  bridge: "vmbr0",
  sshSource: "10.0.0.2",
  nameservers: ["1.1.1.1", "192.168.1.1"],
}

let pve: FakeProxmox
const closers: (() => void)[] = []
const connected: string[] = []

beforeEach(async () => {
  pve = await startFakeProxmox()
  connected.length = 0
})

afterEach(async () => {
  for (const close of closers.splice(0)) close()
  await pve.close()
})

function backendOf(
  overrides: { secret?: string; fingerprint?: string; reach?: () => Promise<void> } = {},
): VmBackend {
  const transport = createProxmoxTransport({
    url: pve.url,
    serverCertificateSha256: overrides.fingerprint ?? pve.fingerprint,
    tokenId: pve.state.tokenId,
    tokenSecret: overrides.secret ?? pve.state.secret,
  })
  closers.push(() => transport.close())
  return createProxmoxBackend({
    client: createProxmoxClient({
      transport,
      node: "pve1",
      requestTimeoutMs: 5_000,
      taskTimeoutMs: 5_000,
      sleep: async () => {},
    }),
    url: pve.url,
    tokenId: pve.state.tokenId,
    layout: LAYOUT,
    owner: OWNER,
    uploadTimeoutMs: 5_000,
    unpack: unpackImage,
    connect: async (host, port): Promise<GuestChannel> => {
      connected.push(`${host}:${port}`)
      return {
        input: { write: async () => {}, end: async () => {} },
        output: (async function* () {})(),
        diagnostics: (async function* () {})(),
        close: () => {},
      }
    },
    reach: overrides.reach ?? (async () => {}),
    now: () => new Date(0),
  })
}

function tarball(rootfs: Buffer) {
  const tar = tarOf([
    { path: "metadata.yaml", mode: 0o644, content: Buffer.from("architecture: x86_64\n") },
    { path: "rootfs.img", mode: 0o644, content: rootfs },
  ])
  const compressed = zstdCompressSync(tar)
  return { bytes: compressed, fingerprint: createHash("sha256").update(compressed).digest("hex") }
}

async function* chunks(bytes: Buffer, size = 1000) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size)
}

async function importImage(backend: VmBackend) {
  const image = tarball(Buffer.alloc(5000, 7))
  const imported = await backend.images.upload({
    fingerprint: image.fingerprint,
    bytes: image.bytes.length,
    body: chunks(image.bytes),
  })
  expect(imported).toBe(image.fingerprint)
  await backend.images.point("dsh-bot-base", imported)
  return image
}

const spec = (botId: string) => ({
  name: `dsh-bot-${botId}`,
  botId,
  owner: OWNER,
  description: `dsh bot ${botId}`,
  image: "dsh-bot-base",
  userData: "#cloud-config\n{}\n",
  resources: { cpus: 2, memoryMiB: 2048, rootDiskGiB: 16 },
  workspace: `dsh-bot-${botId}-workspace`,
})

describe("the Proxmox backend", () => {
  it("is ready with the token's privileges, the pool's declared limits, the storage and the bridge", async () => {
    await expect(backendOf().check()).resolves.toEqual({
      ok: true,
      declaration: {
        kind: "proxmox",
        node: "pve1",
        pool: "dsh-bots",
        storage: "dshbots",
        bridge: "vmbr0",
        limits: { cpus: 8, memoryMiB: 16384 },
      },
    })
  })

  it("names each problem with a fix for the administrator", async () => {
    pve.state.comment = ""
    pve.state.permissions["/pool/dsh-bots"] = ["VM.Audit"]
    pve.state.permissions["/sdn/zones/localnetwork/vmbr0"] = []
    pve.state.storageContent = "images"
    pve.state.version = "8.4.1"
    const result = await backendOf().check()
    if (result.ok) throw new Error("expected problems")
    expect(result.problems.map((problem) => problem.code)).toEqual([
      "version-too-old",
      "privilege-missing",
      "pool-limits-undeclared",
      "storage-unusable",
      "bridge-denied",
    ])
    expect(result.problems[1]?.fix).toEqual({
      kind: "command",
      text: `infra/proxmox/create-pool.sh --pool dsh-bots --storage dshbots --bridge vmbr0 --token ${pve.state.tokenId}`,
    })
    expect(result.problems[3]?.fix).toEqual({
      kind: "command",
      text: "pvesm set dshbots --content images,import,iso",
    })
  })

  it("tells a rejected token and a changed certificate apart from an unreachable server", async () => {
    const rejected = await backendOf({ secret: "wrong-secret" }).check()
    expect(rejected).toMatchObject({
      ok: false,
      problems: [{ scope: "proxmox", code: "token-rejected" }],
    })
    const untrusted = await backendOf({ fingerprint: "00".repeat(32) }).check()
    expect(untrusted).toMatchObject({ ok: false, problems: [{ code: "untrusted" }] })
    await pve.close()
    const gone = await backendOf().check()
    expect(gone).toMatchObject({ ok: false, problems: [{ code: "unreachable" }] })
    pve = await startFakeProxmox()
  })

  it("previews the certificate and the address this installation reaches the API from", async () => {
    await expect(probeProxmox(pve.url)).resolves.toEqual({
      serverCertificateSha256: pve.fingerprint,
      sourceAddress: "127.0.0.1",
    })
  })

  it("imports the image's qcow2 from the tarball as a template the alias points at", async () => {
    const backend = backendOf()
    const image = await importImage(backend)
    expect(
      pve.state.volumes.get(`dshbots:import/dsh-bots-${image.fingerprint}.qcow2`)?.content,
    ).toEqual(Buffer.alloc(5000, 7))
    await expect(backend.images.has(image.fingerprint)).resolves.toBe(true)
    await expect(backend.images.target("dsh-bot-base")).resolves.toBe(image.fingerprint)
    const [template] = [...pve.state.vms.values()]
    expect(template?.template).toBe(true)
    expect(metaOf(template?.config.description)).toEqual({
      kind: "image",
      owner: OWNER,
      fingerprint: image.fingerprint,
      aliases: ["dsh-bot-base"],
    })
  })

  it("refuses a tarball without rootfs.img", async () => {
    const tar = zstdCompressSync(
      tarOf([{ path: "metadata.yaml", mode: 0o644, content: Buffer.from("x") }]),
    )
    await expect(
      backendOf().images.upload({
        fingerprint: "f".repeat(64),
        bytes: tar.length,
        body: chunks(tar),
      }),
    ).rejects.toThrow("no rootfs.img")
  })

  it("makes a bot VM as a linked clone with its seed, workspace and firewall, and reaches it at its address", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    const record = await backend.instances.get("dsh-bot-a")
    expect(record).toMatchObject({
      botId: "a",
      owner: OWNER,
      status: "stopped",
      cpus: 2,
      memoryMiB: 2048,
    })
    const [vmid, vm] = [...pve.state.vms].find(([, entry]) => entry.name === "dsh-bot-a") ?? []
    if (vm === undefined || vmid === undefined) throw new Error("no VM")
    expect(vm.config.ide3).toBe("dshbots:iso/dsh-bots-seed-dsh-bot-a.iso,media=cdrom")
    expect(vm.config.virtio1).toMatch(
      /^dshbots:\d+\/vm-\d+-dsh-bot-a-workspace\.raw,serial=dsh-workspace/,
    )
    expect(vm.config.scsi0).toContain("size=16G")
    expect(vm.config.net0).toContain("firewall=1")
    expect(vm.firewall.options).toMatchObject({ enable: 1, policy_in: "DROP", ipfilter: 1 })
    expect(
      vm.firewall.rules.map((rule) => `${rule.type} ${rule.action} ${rule.dest ?? rule.source}`),
    ).toEqual([
      "in ACCEPT 10.0.0.2",
      "out ACCEPT 192.168.1.1",
      "out ACCEPT 192.168.1.1",
      expect.stringMatching(/^out REJECT 0\.0\.0\.0\/8,10\.0\.0\.0\/8,/),
      "out REJECT ::/0",
    ])
    const seed =
      pve.state.volumes
        .get("dshbots:iso/dsh-bots-seed-dsh-bot-a.iso")
        ?.content.toString("latin1") ?? ""
    expect(seed).toContain("cidata")
    expect(seed).toContain("#cloud-config")
    expect(seed).toContain('"macaddress": "bc:24:11:00:00:')

    await backend.instances.start("dsh-bot-a")
    await expect(backend.guest.open("dsh-bot-a")).rejects.toThrow("guest agent")
    vm.interfaces = [
      {
        name: "lo",
        "hardware-address": "00:00:00:00:00:00",
        "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4" }],
      },
      {
        name: "enp6s18",
        "hardware-address": (/virtio=([^,]+)/.exec(vm.config.net0 ?? "")?.[1] ?? "").toLowerCase(),
        "ip-addresses": [{ "ip-address": "10.250.78.150", "ip-address-type": "ipv4" }],
      },
    ]
    vm.firewall.ipsets["ipfilter-net0"]?.push("10.250.78.99")
    await backend.guest.open("dsh-bot-a")
    expect(connected).toEqual(["10.250.78.150:22"])
    expect(vm.firewall.ipsets["ipfilter-net0"]).toEqual(["10.250.78.150"])

    await backend.instances.settle("dsh-bot-a")
    expect(vm.config.ide3).toBeUndefined()
    const blank =
      pve.state.volumes
        .get("dshbots:iso/dsh-bots-seed-dsh-bot-a.iso")
        ?.content.toString("latin1") ?? ""
    expect(blank).toContain("#cloud-config\n{}")
  })

  it("plans changes: CPU and memory need a restart, a bigger root disk does not", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    const shape = spec("a")
    await expect(backend.instances.change(shape)).resolves.toEqual({ kind: "none" })
    const bigger = { ...shape, resources: { ...shape.resources, rootDiskGiB: 20 } }
    await expect(backend.instances.change(bigger)).resolves.toEqual({
      kind: "live",
      what: ["scsi0 20G"],
    })
    const more = { ...shape, resources: { ...shape.resources, cpus: 4 } }
    await expect(backend.instances.change(more)).resolves.toEqual({
      kind: "restart",
      what: ["cores 4"],
    })
    await backend.instances.conform(more)
    await expect(backend.instances.get("dsh-bot-a")).resolves.toMatchObject({ cpus: 4 })
  })

  it("keeps the workspace when the VM goes, grows it unattached, and deletes it through its holder", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    await expect(backend.workspaces.list(OWNER)).resolves.toEqual([
      {
        name: "dsh-bot-a-workspace",
        botId: "a",
        owner: OWNER,
        orphanedSince: undefined,
        block: true,
        sizeBytes: 4 * GIB,
        sizeText: "4GiB",
        attached: true,
      },
    ])
    await backend.workspaces.grow("dsh-bot-a-workspace", 5)
    await backend.instances.remove("dsh-bot-a")
    await expect(backend.instances.get("dsh-bot-a")).resolves.toBeUndefined()
    await expect(backend.workspaces.get("dsh-bot-a-workspace")).resolves.toMatchObject({
      attached: false,
      sizeBytes: 5 * GIB,
    })
    await backend.workspaces.grow("dsh-bot-a-workspace", 6)
    await expect(backend.workspaces.get("dsh-bot-a-workspace")).resolves.toMatchObject({
      sizeBytes: 6 * GIB,
    })
    await backend.workspaces.markOrphaned("dsh-bot-a-workspace", "2026-11-27T00:00:00.000Z")
    await expect(backend.workspaces.get("dsh-bot-a-workspace")).resolves.toMatchObject({
      orphanedSince: "2026-11-27T00:00:00.000Z",
    })
    await backend.workspaces.remove("dsh-bot-a-workspace")
    await expect(backend.workspaces.list(OWNER)).resolves.toEqual([])
    expect([...pve.state.volumes.keys()].filter((volid) => volid.includes("workspace"))).toEqual([])
  })

  it("does not delete a workspace a VM still uses", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    await expect(backend.workspaces.remove("dsh-bot-a-workspace")).rejects.toThrow("is attached")
  })

  it("drops an old template when its last clone goes", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    const next = tarball(Buffer.alloc(6000, 8))
    const old = await backend.images.target("dsh-bot-base")
    await backend.images.upload({
      fingerprint: next.fingerprint,
      bytes: next.bytes.length,
      body: chunks(next.bytes),
    })
    expect(await backend.images.point("dsh-bot-base", next.fingerprint)).toBe(old)
    await backend.images.discard(old as string)
    await expect(backend.images.has(old as string)).resolves.toBe(true)
    await backend.instances.remove("dsh-bot-a")
    await expect(backend.images.has(old as string)).resolves.toBe(false)
    await expect(backend.images.has(next.fingerprint)).resolves.toBe(true)
  })

  it("sizes bots within the pool's declared limits and the storage's free space", async () => {
    const backend = backendOf()
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    await expect(backend.capacity({ instance: "dsh-bot-b", rootDiskGiB: 16 })).resolves.toEqual({
      cpus: { min: 1, max: 8, step: 1 },
      memoryMiB: { min: 1024, max: 14336, step: 512 },
      diskGiB: { min: 1, max: 44, step: 1, growOnly: true },
    })
  })

  it("reports a running bot VM this installation cannot reach", async () => {
    const backend = backendOf({ reach: async () => Promise.reject(new Error("no route to host")) })
    await importImage(backend)
    await backend.workspaces.create({
      name: "dsh-bot-a-workspace",
      botId: "a",
      owner: OWNER,
      description: "",
      sizeGiB: 4,
    })
    await backend.instances.create(spec("a"))
    await backend.instances.start("dsh-bot-a")
    const vm = [...pve.state.vms.values()].find((entry) => entry.name === "dsh-bot-a")
    if (vm === undefined) throw new Error("no VM")
    vm.interfaces = [
      {
        name: "eth0",
        "hardware-address": (/virtio=([^,]+)/.exec(vm.config.net0 ?? "")?.[1] ?? "").toLowerCase(),
        "ip-addresses": [{ "ip-address": "10.250.78.150", "ip-address-type": "ipv4" }],
      },
    ]
    await expect(backend.check()).resolves.toMatchObject({
      ok: false,
      problems: [{ code: "guest-unreachable" }],
    })
  })
})

describe("Proxmox helpers", () => {
  it("blocks the same IPv4 ranges as the Incus ACL", () => {
    for (const address of [
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "127.0.0.1",
    ]) {
      expect(blockedIpv4(address)).toBe(true)
    }
    for (const address of ["1.1.1.1", "9.9.9.9", "172.32.0.1"])
      expect(blockedIpv4(address)).toBe(false)
  })

  it("writes an ISO 9660 image named cidata with upper-case file names", () => {
    const iso = Buffer.from(isoOf({ "meta-data": "instance-id: x\n" }, new Date(0)))
    expect(iso.length % 2048).toBe(0)
    expect(iso.subarray(16 * 2048 + 1, 16 * 2048 + 6).toString("latin1")).toBe("CD001")
    expect(iso.toString("latin1")).toContain("META-DATA;1")
  })
})
