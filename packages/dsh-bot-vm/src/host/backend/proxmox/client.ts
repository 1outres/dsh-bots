export type ProxmoxMethod = "GET" | "POST" | "PUT" | "DELETE"

export type ProxmoxParams = Readonly<Record<string, string | number>>

export interface ProxmoxResponse {
  readonly status: number
  readonly statusText: string
  readonly body: unknown
}

export interface ProxmoxFile {
  readonly name: string
  readonly bytes: number
  readonly body: AsyncIterable<Uint8Array>
}

export interface ProxmoxTransport {
  request(
    method: ProxmoxMethod,
    path: string,
    params: ProxmoxParams | undefined,
    signal: AbortSignal,
  ): Promise<ProxmoxResponse>
  upload(
    path: string,
    fields: ProxmoxParams,
    file: ProxmoxFile,
    signal: AbortSignal,
  ): Promise<ProxmoxResponse>
}

export class ProxmoxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ProxmoxApiError"
  }
}

export interface ProxmoxVersion {
  readonly version: string
}

export interface ProxmoxNode {
  readonly node: string
  readonly online: boolean
  readonly sslFingerprint: string | undefined
}

export interface PoolMember {
  readonly vmid: number
  readonly name: string
  readonly status: string
  readonly template: boolean
  readonly maxcpu: number | undefined
  readonly maxmem: number | undefined
}

export interface ProxmoxPool {
  readonly comment: string
  readonly vms: readonly PoolMember[]
  readonly storages: readonly string[]
}

export interface StorageStatus {
  readonly type: string
  readonly content: readonly string[]
  readonly active: boolean
  readonly enabled: boolean
  readonly totalBytes: number
  readonly availBytes: number
}

export interface StorageVolume {
  readonly volid: string
  readonly vmid: number | undefined
  readonly sizeBytes: number | undefined
  readonly format: string | undefined
}

export type VmConfig = Readonly<Record<string, string>>

export interface VmStatus {
  readonly status: string
  readonly qmpstatus: string | undefined
}

export interface GuestInterface {
  readonly name: string
  readonly mac: string | undefined
  readonly ipv4: readonly string[]
}

export type PowerAction = "start" | "shutdown" | "resume"

export const SHUTDOWN_SECONDS = 60

export class ProxmoxCertificateError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `the server at ${url} presented the certificate ${actual}, not the pinned ${expected}; refusing to talk to it`,
    )
    this.name = "ProxmoxCertificateError"
  }
}

export interface FirewallRule {
  readonly pos: number
  readonly type: string
  readonly action: string
  readonly dest: string | undefined
  readonly source: string | undefined
}

export type ProxmoxFirewallRule = ProxmoxParams

export interface ProxmoxClient {
  readonly node: string
  version(signal?: AbortSignal): Promise<ProxmoxVersion>
  nodes(signal?: AbortSignal): Promise<readonly ProxmoxNode[]>
  permissions(path: string, signal?: AbortSignal): Promise<ReadonlySet<string>>
  pool(pool: string, signal?: AbortSignal): Promise<ProxmoxPool | undefined>
  storage(storage: string, signal?: AbortSignal): Promise<StorageStatus | undefined>
  volumes(
    storage: string,
    query: ProxmoxParams,
    signal?: AbortSignal,
  ): Promise<readonly StorageVolume[]>
  allocate(storage: string, params: ProxmoxParams, signal?: AbortSignal): Promise<string>
  upload(
    storage: string,
    content: string,
    file: ProxmoxFile,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void>
  bridges(signal?: AbortSignal): Promise<readonly string[]>
  nextId(signal?: AbortSignal): Promise<number>
  config(vmid: number, signal?: AbortSignal): Promise<VmConfig>
  status(vmid: number, signal?: AbortSignal): Promise<VmStatus>
  createVm(params: ProxmoxParams, signal?: AbortSignal): Promise<void>
  clone(vmid: number, params: ProxmoxParams, signal?: AbortSignal): Promise<void>
  configure(vmid: number, params: ProxmoxParams, signal?: AbortSignal): Promise<void>
  resize(vmid: number, disk: string, size: string, signal?: AbortSignal): Promise<void>
  power(vmid: number, action: PowerAction, signal?: AbortSignal): Promise<void>
  template(vmid: number, signal?: AbortSignal): Promise<void>
  destroy(vmid: number, signal?: AbortSignal): Promise<void>
  guestInterfaces(vmid: number, signal?: AbortSignal): Promise<readonly GuestInterface[]>
  firewallOptions(vmid: number, options: ProxmoxParams, signal?: AbortSignal): Promise<void>
  firewallRules(vmid: number, signal?: AbortSignal): Promise<readonly FirewallRule[]>
  addFirewallRule(vmid: number, rule: ProxmoxFirewallRule, signal?: AbortSignal): Promise<void>
  deleteFirewallRule(vmid: number, pos: number, signal?: AbortSignal): Promise<void>
  ipsets(vmid: number, signal?: AbortSignal): Promise<readonly string[]>
  createIpset(vmid: number, name: string, signal?: AbortSignal): Promise<void>
  ipsetEntries(vmid: number, name: string, signal?: AbortSignal): Promise<readonly string[]>
  addIpsetEntry(vmid: number, name: string, cidr: string, signal?: AbortSignal): Promise<void>
  deleteIpsetEntry(vmid: number, name: string, cidr: string, signal?: AbortSignal): Promise<void>
}

export interface ProxmoxClientOptions {
  readonly transport: ProxmoxTransport
  readonly node: string
  readonly requestTimeoutMs: number
  readonly taskTimeoutMs: number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

type Fields = Readonly<Record<string, unknown>>

const TASK_POLL_MS = 500
const TASK_LOG_LINES = 20
const UPID = /^UPID:/

const recordOf = (value: unknown): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : {}
const listOf = (value: unknown): readonly Fields[] =>
  Array.isArray(value) ? value.map(recordOf) : []
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined
const numberOf = (value: unknown): number | undefined => {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) ? number : undefined
}
const flagOf = (value: unknown) => value === 1 || value === "1" || value === true

export const isNotFound = (error: unknown) =>
  error instanceof ProxmoxApiError &&
  (error.status === 404 ||
    (error.status === 500 && /does not exist|not found|no such/i.test(error.message)))

function errorText(response: ProxmoxResponse): string {
  const errors = recordOf(recordOf(response.body).errors)
  const detail = Object.entries(errors)
    .map(([field, message]) => `${field}: ${String(message).trim()}`)
    .join("; ")
  const head = response.statusText.trim() || "no message"
  return detail === "" ? head : `${head} (${detail})`
}

const enc = encodeURIComponent

export function createProxmoxClient(options: ProxmoxClientOptions): ProxmoxClient {
  const { transport, node } = options
  const nodePath = `/nodes/${enc(node)}`
  const vmPath = (vmid: number) => `${nodePath}/qemu/${vmid}`
  const firewallPath = (vmid: number) => `${vmPath(vmid)}/firewall`

  function bounded(signal: AbortSignal | undefined, ms: number) {
    const deadline = AbortSignal.timeout(ms)
    return {
      deadline,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    }
  }

  function checked(method: string, path: string, response: ProxmoxResponse): unknown {
    if (response.status >= 400) {
      throw new ProxmoxApiError(
        `Proxmox ${method} ${path} failed (${response.status}): ${errorText(response)}`,
        response.status,
      )
    }
    return recordOf(response.body).data
  }

  async function call(
    method: ProxmoxMethod,
    path: string,
    params?: ProxmoxParams,
    signal?: AbortSignal,
    timeoutMs = options.requestTimeoutMs,
  ): Promise<unknown> {
    const limit = bounded(signal, timeoutMs)
    let response: ProxmoxResponse
    try {
      response = await transport.request(method, path, params, limit.signal)
    } catch (error) {
      if (limit.deadline.aborted && !signal?.aborted) {
        throw new Error(`Proxmox ${method} ${path} did not answer within ${timeoutMs} ms`)
      }
      throw error
    }
    return checked(method, path, response)
  }

  async function wait(what: string, upid: unknown, signal?: AbortSignal): Promise<void> {
    if (typeof upid !== "string" || !UPID.test(upid)) return
    const taskPath = `${nodePath}/tasks/${enc(upid)}`
    const limit = bounded(signal, options.taskTimeoutMs)
    for (;;) {
      if (limit.deadline.aborted && !signal?.aborted) {
        throw new Error(`Proxmox ${what} did not finish within ${options.taskTimeoutMs} ms`)
      }
      signal?.throwIfAborted()
      const status = recordOf(await call("GET", `${taskPath}/status`, undefined, signal))
      if (status.status === "stopped") {
        const exit = textOf(status.exitstatus) ?? "unknown"
        if (exit === "OK" || exit.startsWith("WARNINGS")) return
        const log = listOf(await call("GET", `${taskPath}/log`, { limit: 500 }, signal))
          .map((line) => textOf(line.t) ?? "")
          .filter((line) => line !== "" && line !== "TASK OK")
          .slice(-TASK_LOG_LINES)
        throw new Error(
          `Proxmox ${what} failed: ${exit}${log.length > 0 ? ` (${log.join(" | ")})` : ""}`,
        )
      }
      await options.sleep(TASK_POLL_MS, limit.signal)
    }
  }

  async function task(
    what: string,
    method: ProxmoxMethod,
    path: string,
    params?: ProxmoxParams,
    signal?: AbortSignal,
  ): Promise<void> {
    await wait(what, await call(method, path, params, signal, options.taskTimeoutMs), signal)
  }

  async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read()
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  return {
    node,
    async version(signal) {
      const data = recordOf(await call("GET", "/version", undefined, signal))
      return { version: textOf(data.version) ?? "" }
    },
    async nodes(signal) {
      return listOf(await call("GET", "/nodes", undefined, signal)).flatMap((entry) => {
        const name = textOf(entry.node)
        if (name === undefined) return []
        return [
          {
            node: name,
            online: entry.status === "online",
            sslFingerprint: textOf(entry.ssl_fingerprint),
          },
        ]
      })
    },
    async permissions(path, signal) {
      const data = recordOf(await call("GET", "/access/permissions", { path }, signal))
      const granted = recordOf(data[path])
      return new Set(Object.keys(granted))
    },
    pool: (pool, signal) =>
      optional(async () => {
        const data = recordOf(await call("GET", `/pools/${enc(pool)}`, undefined, signal))
        const members = listOf(data.members)
        return {
          comment: textOf(data.comment) ?? "",
          vms: members.flatMap((member) => {
            const vmid = numberOf(member.vmid)
            if (member.type !== "qemu" || vmid === undefined) return []
            return [
              {
                vmid,
                name: textOf(member.name) ?? "",
                status: textOf(member.status) ?? "unknown",
                template: flagOf(member.template),
                maxcpu: numberOf(member.maxcpu),
                maxmem: numberOf(member.maxmem),
              },
            ]
          }),
          storages: members.flatMap((member) => {
            const storage = textOf(member.storage)
            return member.type === "storage" && storage !== undefined ? [storage] : []
          }),
        }
      }),
    storage: (storage, signal) =>
      optional(async () => {
        const data = recordOf(
          await call("GET", `${nodePath}/storage/${enc(storage)}/status`, undefined, signal),
        )
        return {
          type: textOf(data.type) ?? "",
          content: (textOf(data.content) ?? "").split(",").filter((item) => item !== ""),
          active: flagOf(data.active),
          enabled: data.enabled === undefined ? true : flagOf(data.enabled),
          totalBytes: numberOf(data.total) ?? 0,
          availBytes: numberOf(data.avail) ?? 0,
        }
      }),
    async volumes(storage, query, signal) {
      const data = await call("GET", `${nodePath}/storage/${enc(storage)}/content`, query, signal)
      return listOf(data).flatMap((entry) => {
        const volid = textOf(entry.volid)
        if (volid === undefined) return []
        return [
          {
            volid,
            vmid: numberOf(entry.vmid),
            sizeBytes: numberOf(entry.size),
            format: textOf(entry.format),
          },
        ]
      })
    },
    async allocate(storage, params, signal) {
      const volid = textOf(
        await call("POST", `${nodePath}/storage/${enc(storage)}/content`, params, signal),
      )
      if (volid === undefined)
        throw new Error(`Proxmox did not name the volume it allocated on ${storage}`)
      return volid
    },
    async upload(storage, content, file, timeoutMs, signal) {
      const path = `${nodePath}/storage/${enc(storage)}/upload`
      const limit = bounded(signal, timeoutMs)
      let response: ProxmoxResponse
      try {
        response = await transport.upload(path, { content }, file, limit.signal)
      } catch (error) {
        if (limit.deadline.aborted && !signal?.aborted) {
          throw new Error(`sending ${file.name} to Proxmox did not finish within ${timeoutMs} ms`)
        }
        throw error
      }
      await wait(`upload of ${file.name}`, checked("POST", path, response), signal)
    },
    async bridges(signal) {
      return listOf(
        await call("GET", `${nodePath}/network`, { type: "any_bridge" }, signal),
      ).flatMap((entry) => {
        const iface = textOf(entry.iface)
        return iface === undefined ? [] : [iface]
      })
    },
    async nextId(signal) {
      const id = numberOf(await call("GET", "/cluster/nextid", undefined, signal))
      if (id === undefined) throw new Error("Proxmox did not give a free VM id")
      return id
    },
    async config(vmid, signal) {
      const data = recordOf(await call("GET", `${vmPath(vmid)}/config`, undefined, signal))
      return Object.fromEntries(
        Object.entries(data).flatMap(([key, value]) => {
          const text = textOf(value)
          return text === undefined ? [] : [[key, text]]
        }),
      )
    },
    async status(vmid, signal) {
      const data = recordOf(await call("GET", `${vmPath(vmid)}/status/current`, undefined, signal))
      return { status: textOf(data.status) ?? "unknown", qmpstatus: textOf(data.qmpstatus) }
    },
    createVm: (params, signal) =>
      task(`creating VM ${params.vmid}`, "POST", `${nodePath}/qemu`, params, signal),
    clone: (vmid, params, signal) =>
      task(`cloning VM ${vmid}`, "POST", `${vmPath(vmid)}/clone`, params, signal),
    configure: (vmid, params, signal) =>
      task(`configuring VM ${vmid}`, "POST", `${vmPath(vmid)}/config`, params, signal),
    resize: (vmid, disk, size, signal) =>
      task(
        `resizing ${disk} of VM ${vmid}`,
        "PUT",
        `${vmPath(vmid)}/resize`,
        { disk, size },
        signal,
      ),
    power: (vmid, action, signal) =>
      task(
        `${action} of VM ${vmid}`,
        "POST",
        `${vmPath(vmid)}/status/${action}`,
        action === "shutdown" ? { timeout: SHUTDOWN_SECONDS, forceStop: 1 } : undefined,
        signal,
      ),
    template: (vmid, signal) =>
      task(
        `turning VM ${vmid} into a template`,
        "POST",
        `${vmPath(vmid)}/template`,
        undefined,
        signal,
      ),
    destroy: (vmid, signal) =>
      task(
        `deleting VM ${vmid}`,
        "DELETE",
        vmPath(vmid),
        { purge: 1, "destroy-unreferenced-disks": 0 },
        signal,
      ),
    async guestInterfaces(vmid, signal) {
      const data = recordOf(
        await call("GET", `${vmPath(vmid)}/agent/network-get-interfaces`, undefined, signal),
      )
      return listOf(data.result).map((entry) => ({
        name: textOf(entry.name) ?? "",
        mac: textOf(entry["hardware-address"])?.toLowerCase(),
        ipv4: listOf(entry["ip-addresses"]).flatMap((address) => {
          const ip = textOf(address["ip-address"])
          return address["ip-address-type"] === "ipv4" && ip !== undefined ? [ip] : []
        }),
      }))
    },
    async firewallOptions(vmid, values, signal) {
      await call("PUT", `${firewallPath(vmid)}/options`, values, signal)
    },
    async firewallRules(vmid, signal) {
      return listOf(await call("GET", `${firewallPath(vmid)}/rules`, undefined, signal))
        .flatMap((rule) => {
          const pos = numberOf(rule.pos)
          return pos === undefined
            ? []
            : [
                {
                  pos,
                  type: textOf(rule.type) ?? "",
                  action: textOf(rule.action) ?? "",
                  dest: textOf(rule.dest),
                  source: textOf(rule.source),
                },
              ]
        })
        .sort((a, b) => a.pos - b.pos)
    },
    async addFirewallRule(vmid, rule, signal) {
      await call("POST", `${firewallPath(vmid)}/rules`, rule, signal)
    },
    async deleteFirewallRule(vmid, pos, signal) {
      await call("DELETE", `${firewallPath(vmid)}/rules/${pos}`, undefined, signal)
    },
    async ipsets(vmid, signal) {
      return listOf(await call("GET", `${firewallPath(vmid)}/ipset`, undefined, signal)).flatMap(
        (set) => {
          const name = textOf(set.name)
          return name === undefined ? [] : [name]
        },
      )
    },
    async createIpset(vmid, name, signal) {
      await call("POST", `${firewallPath(vmid)}/ipset`, { name }, signal)
    },
    async ipsetEntries(vmid, name, signal) {
      return listOf(
        await call("GET", `${firewallPath(vmid)}/ipset/${enc(name)}`, undefined, signal),
      ).flatMap((entry) => {
        const cidr = textOf(entry.cidr)
        return cidr === undefined ? [] : [cidr]
      })
    },
    async addIpsetEntry(vmid, name, cidr, signal) {
      await call("POST", `${firewallPath(vmid)}/ipset/${enc(name)}`, { cidr }, signal)
    },
    async deleteIpsetEntry(vmid, name, cidr, signal) {
      await call(
        "DELETE",
        `${firewallPath(vmid)}/ipset/${enc(name)}/${enc(cidr)}`,
        undefined,
        signal,
      )
    },
  }
}
