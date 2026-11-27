import { createHash, X509Certificate } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer } from "node:https"
import type { AddressInfo } from "node:net"
import { createSelfSignedIdentity } from "../../src/node/client-identity"

export interface FakeVm {
  name: string
  config: Record<string, string>
  status: "running" | "stopped"
  template: boolean
  firewall: {
    options: Record<string, unknown>
    rules: Record<string, unknown>[]
    ipsets: Record<string, string[]>
  }
  interfaces:
    | {
        name: string
        "hardware-address": string
        "ip-addresses": { "ip-address": string; "ip-address-type": string }[]
      }[]
    | undefined
}

export interface FakeVolume {
  vmid: number | undefined
  size: number
  content: Buffer
}

export interface FakeProxmoxState {
  tokenId: string
  secret: string
  version: string
  comment: string
  poolStorages: string[]
  permissions: Record<string, string[]>
  storageContent: string
  bridges: string[]
  vms: Map<number, FakeVm>
  volumes: Map<string, FakeVolume>
  nextId: number
  failTask: RegExp | undefined
}

export interface FakeProxmox {
  readonly url: string
  readonly fingerprint: string
  readonly state: FakeProxmoxState
  readonly requests: string[]
  close(): Promise<void>
}

const GIB = 1024 ** 3
const NODE = "pve1"
const STORAGE = "dshbots"
const POOL = "dsh-bots"
const OWNED_DISK = /^(scsi|virtio|ide|sata|efidisk|unused)\d+$/

export const ALL_PRIVILEGES = [
  "VM.Allocate",
  "VM.Audit",
  "VM.Clone",
  "VM.Config.CDROM",
  "VM.Config.CPU",
  "VM.Config.Disk",
  "VM.Config.HWType",
  "VM.Config.Memory",
  "VM.Config.Network",
  "VM.Config.Options",
  "VM.PowerMgmt",
  "VM.GuestAgent.Audit",
  "Pool.Audit",
  "Datastore.Audit",
  "Datastore.AllocateSpace",
  "Datastore.AllocateTemplate",
]

function reply(res: ServerResponse, status: number, data: unknown, message?: string) {
  const text = JSON.stringify({ data })
  res.writeHead(status, message ?? (status < 400 ? "OK" : "error"), {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  })
  res.end(text)
}

const sizeText = (bytes: number) => `${bytes / GIB}G`
const parseSize = (text: string, current: number) => {
  const match = /^(\+)?(\d+)G$/.exec(text)
  if (match === null) throw new Error(`bad size ${text}`)
  return (match[1] === "+" ? current : 0) + Number(match[2]) * GIB
}

function multipart(
  body: Buffer,
  contentType: string,
): { fields: Record<string, string>; file: { name: string; data: Buffer } } {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? ""
  const fields: Record<string, string> = {}
  let file = { name: "", data: Buffer.alloc(0) }
  const separator = Buffer.from(`--${boundary}`)
  let at = body.indexOf(separator)
  while (at !== -1) {
    const next = body.indexOf(separator, at + separator.length)
    if (next === -1) break
    const part = body.subarray(at + separator.length + 2, next - 2)
    const split = part.indexOf("\r\n\r\n")
    const head = part.subarray(0, split).toString("utf8")
    const content = part.subarray(split + 4)
    const name = /name="([^"]+)"/.exec(head)?.[1] ?? ""
    const filename = /filename="([^"]+)"/.exec(head)?.[1]
    if (filename !== undefined) file = { name: filename, data: Buffer.from(content) }
    else fields[name] = content.toString("utf8")
    at = next
  }
  return { fields, file }
}

export async function startFakeProxmox(): Promise<FakeProxmox> {
  const identity = createSelfSignedIdentity({
    commonName: "fake-pve",
    now: new Date(),
    usage: "server",
  })
  const fingerprint = createHash("sha256")
    .update(new X509Certificate(identity.certificate).raw)
    .digest("hex")
  const state: FakeProxmoxState = {
    tokenId: "dsh-bots@pve!plugin",
    secret: "11111111-2222-3333-4444-555555555555",
    version: "9.3.1",
    comment: "dsh-bots: cpus=8 memory=16GiB",
    poolStorages: [STORAGE],
    permissions: {
      [`/pool/${POOL}`]: ALL_PRIVILEGES,
      [`/storage/${STORAGE}`]: ALL_PRIVILEGES,
      "/sdn/zones/localnetwork/vmbr0": ["SDN.Use", "SDN.Audit"],
    },
    storageContent: "images,import,iso",
    bridges: ["vmbr0"],
    vms: new Map(),
    volumes: new Map(),
    nextId: 100,
    failTask: undefined,
  }
  const requests: string[] = []
  let upid = 0
  const tasks = new Map<string, string>()
  const task = (what: string) => {
    const id = `UPID:${NODE}:${(++upid).toString(16)}:${what}:`
    tasks.set(id, state.failTask?.test(what) ? "failed: no" : "OK")
    return id
  }
  const macOf = (vmid: number) =>
    `BC:24:11:00:00:${(vmid % 256).toString(16).padStart(2, "0").toUpperCase()}`
  const vmOf = (vmid: number) => {
    const vm = state.vms.get(vmid)
    if (vm === undefined)
      throw Object.assign(new Error(`VM ${vmid} does not exist`), { status: 500 })
    return vm
  }
  const ownsVolume = (vmid: number, volid: string) => volid.startsWith(`${STORAGE}:${vmid}/`)
  const allocate = (vmid: number, name: string, bytes: number) => {
    const volid = `${STORAGE}:${vmid}/${name}`
    state.volumes.set(volid, { vmid, size: bytes, content: Buffer.alloc(0) })
    return volid
  }
  const diskValue = (volid: string, rest: string, bytes: number) =>
    [
      volid,
      ...rest.split(",").filter((part) => part !== "" && !part.startsWith("size=")),
      `size=${sizeText(bytes)}`,
    ].join(",")

  function configure(vmid: number, params: Record<string, unknown>) {
    const vm = vmOf(vmid)
    for (const key of String(params.delete ?? "")
      .split(",")
      .filter((item) => item !== "")) {
      const value = vm.config[key]
      delete vm.config[key]
      if (value === undefined || !OWNED_DISK.test(key)) continue
      const volid = value.split(",")[0] as string
      if (!ownsVolume(vmid, volid)) continue
      if (key.startsWith("unused")) state.volumes.delete(volid)
      else {
        let slot = 0
        while (vm.config[`unused${slot}`] !== undefined) slot++
        vm.config[`unused${slot}`] = volid
      }
    }
    for (const [key, raw] of Object.entries(params)) {
      if (key === "delete" || key === "digest") continue
      let value = String(raw)
      const fresh = /^([a-z0-9]+):(\d+)(,.*)?$/.exec(value)
      if (OWNED_DISK.test(key) && fresh !== null && fresh[1] === STORAGE) {
        const volid = allocate(vmid, `vm-${vmid}-disk-${key}.qcow2`, Number(fresh[2]) * GIB)
        value = diskValue(
          volid,
          (fresh[3] ?? "").replace(/,?import-from=[^,]+/, ""),
          Number(fresh[2]) * GIB || 10 * GIB,
        )
        const volume = state.volumes.get(volid)
        if (volume !== undefined) volume.size = Number(fresh[2]) * GIB || 10 * GIB
      } else if (
        OWNED_DISK.test(key) &&
        !key.startsWith("unused") &&
        !value.includes("media=cdrom")
      ) {
        const volid = value.split(",")[0] as string
        const volume = state.volumes.get(volid)
        if (volume === undefined)
          throw Object.assign(new Error(`volume ${volid} does not exist`), { status: 500 })
        value = diskValue(volid, value.slice(volid.length), volume.size)
      }
      vm.config[key] = value
    }
  }

  function route(
    method: string,
    path: string,
    params: Record<string, unknown>,
    req: IncomingMessage,
    body: Buffer,
  ): [number, unknown] {
    const qemu = /^\/nodes\/pve1\/qemu\/(\d+)(\/.*)?$/.exec(path)
    if (method === "GET" && path === "/version")
      return [200, { version: state.version, release: "9.3" }]
    if (method === "GET" && path === "/nodes") {
      return [
        200,
        [
          {
            node: NODE,
            status: "online",
            ssl_fingerprint: fingerprint.toUpperCase().match(/../g)?.join(":"),
          },
        ],
      ]
    }
    if (method === "GET" && path === "/access/permissions") {
      const wanted = String(params.path)
      return [
        200,
        {
          [wanted]: Object.fromEntries((state.permissions[wanted] ?? []).map((name) => [name, 0])),
        },
      ]
    }
    if (method === "GET" && path === `/pools/${POOL}`) {
      return [
        200,
        {
          poolid: POOL,
          comment: state.comment,
          members: [
            ...[...state.vms].map(([vmid, vm]) => ({
              type: "qemu",
              id: `qemu/${vmid}`,
              vmid,
              name: vm.name,
              status: vm.status,
              template: vm.template ? 1 : 0,
              maxcpu: Number(vm.config.cores ?? 1),
              maxmem: Number(vm.config.memory ?? 512) * 1024 * 1024,
            })),
            ...state.poolStorages.map((storage) => ({ type: "storage", storage })),
          ],
        },
      ]
    }
    if (method === "GET" && path === `/nodes/pve1/storage/${STORAGE}/status`) {
      return [
        200,
        {
          type: "dir",
          content: state.storageContent,
          active: 1,
          enabled: 1,
          total: 100 * GIB,
          avail: 60 * GIB,
        },
      ]
    }
    if (method === "GET" && path === `/nodes/pve1/storage/${STORAGE}/content`) {
      return [
        200,
        [...state.volumes]
          .filter(
            ([, volume]) =>
              params.vmid === undefined || String(volume.vmid) === String(params.vmid),
          )
          .map(([volid, volume]) => ({
            volid,
            vmid: volume.vmid,
            size: volume.size,
            format: "raw",
          })),
      ]
    }
    if (method === "POST" && path === `/nodes/pve1/storage/${STORAGE}/content`) {
      const vmid = Number(params.vmid)
      const filename = String(params.filename)
      if (!filename.startsWith(`vm-${vmid}-`)) return [400, null]
      return [200, allocate(vmid, filename, parseSize(String(params.size), 0))]
    }
    if (method === "POST" && path === `/nodes/pve1/storage/${STORAGE}/upload`) {
      const { fields, file } = multipart(body, String(req.headers["content-type"]))
      state.volumes.set(`${STORAGE}:${fields.content}/${file.name}`, {
        vmid: undefined,
        size: file.data.length,
        content: file.data,
      })
      return [200, task("imgcopy")]
    }
    if (method === "GET" && path === "/nodes/pve1/network")
      return [200, state.bridges.map((iface) => ({ iface, type: "bridge" }))]
    if (method === "GET" && path === "/cluster/nextid") {
      while (state.vms.has(state.nextId)) state.nextId++
      return [200, String(state.nextId)]
    }
    const taskPath = /^\/nodes\/pve1\/tasks\/([^/]+)\/(status|log)$/.exec(path)
    if (taskPath !== null) {
      const exit = tasks.get(decodeURIComponent(taskPath[1] as string))
      if (taskPath[2] === "log") return [200, [{ n: 1, t: "the fake task failed" }]]
      return [200, { status: "stopped", exitstatus: exit }]
    }
    if (method === "POST" && path === "/nodes/pve1/qemu") {
      const vmid = Number(params.vmid)
      if (state.vms.has(vmid)) return [500, null]
      if (params.pool !== POOL) return [403, null]
      state.vms.set(vmid, {
        name: String(params.name),
        config: {},
        status: "stopped",
        template: false,
        firewall: { options: {}, rules: [], ipsets: {} },
        interfaces: undefined,
      })
      const { vmid: _, pool: __, name: ___, ...rest } = params
      configure(vmid, { ...rest, name: params.name })
      return [200, task("qmcreate")]
    }
    if (qemu === null) return [404, null]
    const vmid = Number(qemu[1])
    const rest = qemu[2] ?? ""
    const vm = vmOf(vmid)
    switch (`${method} ${rest}`) {
      case "GET /config":
        return [200, vm.config]
      case "POST /config":
      case "PUT /config":
        configure(vmid, params)
        return [200, method === "POST" ? task("qmconfig") : null]
      case "GET /status/current":
        return [200, { status: vm.status, qmpstatus: vm.status }]
      case "POST /status/start":
        vm.status = "running"
        return [200, task("qmstart")]
      case "POST /status/shutdown":
        vm.status = "stopped"
        return [200, task("qmshutdown")]
      case "POST /template": {
        vm.template = true
        vm.config.template = "1"
        for (const [key, value] of Object.entries(vm.config)) {
          if (!OWNED_DISK.test(key)) continue
          const volid = value.split(",")[0] as string
          const base = volid.replace(`/vm-${vmid}-`, `/base-${vmid}-`)
          const volume = state.volumes.get(volid)
          if (volume === undefined) continue
          state.volumes.delete(volid)
          state.volumes.set(base, volume)
          vm.config[key] = value.replace(volid, base)
        }
        return [200, task("qmtemplate")]
      }
      case "POST /clone": {
        const newid = Number(params.newid)
        if (state.vms.has(newid)) return [500, null]
        const config: Record<string, string> = { ...vm.config, name: String(params.name) }
        delete config.template
        for (const [key, value] of Object.entries(vm.config)) {
          if (!OWNED_DISK.test(key)) continue
          const volid = value.split(",")[0] as string
          const linked = `${volid}/${newid}/vm-${newid}-disk-${key}.qcow2`
          state.volumes.set(linked, {
            vmid: newid,
            size: state.volumes.get(volid)?.size ?? GIB,
            content: Buffer.alloc(0),
          })
          config[key] = value.replace(volid, linked)
        }
        config.net0 = `virtio=${macOf(newid)},bridge=vmbr0,firewall=1`
        state.vms.set(newid, {
          name: String(params.name),
          config,
          status: "stopped",
          template: false,
          firewall: { options: {}, rules: [], ipsets: {} },
          interfaces: undefined,
        })
        return [200, task("qmclone")]
      }
      case "PUT /resize": {
        const key = String(params.disk)
        const value = vm.config[key]
        if (value === undefined) return [500, null]
        const volid = value.split(",")[0] as string
        const volume = state.volumes.get(volid)
        if (volume === undefined) return [500, null]
        const size = parseSize(String(params.size), volume.size)
        if (size < volume.size) return [500, null]
        volume.size = size
        vm.config[key] = diskValue(volid, value.slice(volid.length), size)
        return [200, task("resize")]
      }
      case "DELETE ": {
        for (const [key, value] of Object.entries(vm.config)) {
          const volid = value.split(",")[0] as string
          if (OWNED_DISK.test(key) && ownsVolume(vmid, volid)) state.volumes.delete(volid)
          if (OWNED_DISK.test(key) && volid.includes(`/${vmid}/vm-${vmid}-`))
            state.volumes.delete(volid)
        }
        state.vms.delete(vmid)
        return [200, task("qmdestroy")]
      }
      case "GET /agent/network-get-interfaces":
        if (vm.interfaces === undefined) return [500, null]
        return [200, { result: vm.interfaces }]
      case "PUT /firewall/options":
        vm.firewall.options = params
        return [200, null]
      case "GET /firewall/rules":
        return [200, vm.firewall.rules.map((rule, pos) => ({ ...rule, pos }))]
      case "POST /firewall/rules": {
        const { pos, ...rule } = params
        vm.firewall.rules.splice(Number(pos ?? 0), 0, rule)
        return [200, null]
      }
      case "GET /firewall/ipset":
        return [200, Object.keys(vm.firewall.ipsets).map((name) => ({ name }))]
      case "POST /firewall/ipset":
        vm.firewall.ipsets[String(params.name)] = []
        return [200, null]
    }
    const rule = /^\/firewall\/rules\/(\d+)$/.exec(rest)
    if (method === "DELETE" && rule !== null) {
      vm.firewall.rules.splice(Number(rule[1]), 1)
      return [200, null]
    }
    const ipset = /^\/firewall\/ipset\/([^/]+)(?:\/(.+))?$/.exec(rest)
    if (ipset !== null) {
      const name = decodeURIComponent(ipset[1] as string)
      const entries = vm.firewall.ipsets[name]
      if (entries === undefined) return [500, null]
      if (method === "GET") return [200, entries.map((cidr) => ({ cidr }))]
      if (method === "POST") entries.push(String(params.cidr))
      if (method === "DELETE")
        entries.splice(entries.indexOf(decodeURIComponent(ipset[2] as string)), 1)
      return [200, null]
    }
    return [404, null]
  }

  const server = createServer({ cert: identity.certificate, key: identity.key }, (req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "https://fake")
      const path = url.pathname.replace(/^\/api2\/json/, "")
      const body = Buffer.concat(chunks)
      requests.push(`${req.method} ${path}`)
      if (req.headers.authorization !== `PVEAPIToken=${state.tokenId}=${state.secret}`) {
        return reply(res, 401, null, "authentication failure")
      }
      const json = String(req.headers["content-type"]).startsWith("application/json")
      const params: Record<string, unknown> = json
        ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>)
        : Object.fromEntries(url.searchParams)
      try {
        const [status, data] = route(req.method ?? "GET", path, params, req, body)
        reply(res, status, data, status === 403 ? "Permission check failed" : undefined)
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500
        reply(res, status, null, (error as Error).message)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    fingerprint,
    state,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
