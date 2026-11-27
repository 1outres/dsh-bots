import type {
  EnvironmentHostDeclaration,
  EnvironmentHostProblem,
  ProblemFix,
  ProxmoxProblemCode,
} from "@1outres/dsh-bot-core"
import type { BackendCheck } from "../contract"
import { ProxmoxApiError, ProxmoxCertificateError, type ProxmoxClient } from "./client"
import type { ProxmoxLayout } from "./endpoint"
import type { Inventory } from "./inventory"
import { REQUIRED_CONTENT, SSH_PORT } from "./layout"
import { limitsLine, poolLimitsOf } from "./limits"
import { guestAddress } from "./network"

export const MIN_PROXMOX_VERSION = [9, 0] as const

export const POOL_PRIVILEGES = [
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
] as const

export const STORAGE_PRIVILEGES = [
  "Datastore.Audit",
  "Datastore.AllocateSpace",
  "Datastore.AllocateTemplate",
] as const

export const BRIDGE_PRIVILEGES = ["SDN.Use"] as const

const GUESTS_PROBED = 3

export type GuestReach = (host: string, port: number, signal?: AbortSignal) => Promise<void>

export interface ProxmoxCheckTarget {
  readonly client: ProxmoxClient
  readonly inventory: Inventory
  readonly layout: ProxmoxLayout
  readonly url: string
  readonly tokenId: string
  readonly owner: string
  readonly reach: GuestReach
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const command = (text: string): ProblemFix => ({ kind: "command", text })
const sentence = (text: string): ProblemFix => ({ kind: "text", text })

const problem = (
  code: ProxmoxProblemCode,
  message: string,
  fix: ProblemFix,
): EnvironmentHostProblem => ({
  scope: "proxmox",
  code,
  message,
  fix,
})

function versionAtLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < minimum.length; index++) {
    const have = parts[index] ?? 0
    const want = minimum[index] as number
    if (Number.isNaN(have)) return false
    if (have !== want) return have > want
  }
  return true
}

export const privilegePath = {
  pool: (pool: string) => `/pool/${pool}`,
  storage: (storage: string) => `/storage/${storage}`,
  bridge: (bridge: string) => `/sdn/zones/localnetwork/${bridge}`,
}

export function setupCommand(layout: ProxmoxLayout, tokenId: string): string {
  return `infra/proxmox/create-pool.sh --pool ${layout.pool} --storage ${layout.storage} --bridge ${layout.bridge} --token ${tokenId}`
}

function connectionProblem(target: ProxmoxCheckTarget, error: unknown): EnvironmentHostProblem {
  if (error instanceof ProxmoxCertificateError) {
    return problem(
      "untrusted",
      error.message,
      sentence(
        "compare the node's certificate (pvenode cert info) with the pinned one, then connect again",
      ),
    )
  }
  if (error instanceof ProxmoxApiError && error.status === 401) {
    return problem(
      "token-rejected",
      `Proxmox rejects the API token ${target.tokenId}: ${error.message}`,
      sentence("ask the administrator for a new API token and connect again"),
    )
  }
  return problem(
    "unreachable",
    `the Proxmox API at ${target.url} does not answer: ${messageOf(error)}`,
    sentence("check that the node is up and that port 8006 is reachable from here"),
  )
}

async function missingPrivileges(
  client: ProxmoxClient,
  path: string,
  wanted: readonly string[],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const granted = await client.permissions(path, signal)
  return wanted.filter((privilege) => !granted.has(privilege))
}

export async function checkProxmox(
  target: ProxmoxCheckTarget,
  signal?: AbortSignal,
): Promise<BackendCheck> {
  const { client, layout } = target
  const admin = command(setupCommand(layout, target.tokenId))
  let version: string
  try {
    version = (await client.version(signal)).version
  } catch (error) {
    return { ok: false, problems: [connectionProblem(target, error)] }
  }
  const problems: EnvironmentHostProblem[] = []
  if (!versionAtLeast(version, MIN_PROXMOX_VERSION)) {
    problems.push(
      problem(
        "version-too-old",
        `Proxmox VE ${version || "(unknown version)"} is older than ${MIN_PROXMOX_VERSION.join(".")}`,
        sentence("upgrade Proxmox VE on the node"),
      ),
    )
  }
  const nodes = await client.nodes(signal)
  const node = nodes.find((entry) => entry.node === layout.node)
  if (node === undefined || !node.online) {
    problems.push(
      problem(
        "node-missing",
        node === undefined
          ? `the node "${layout.node}" is not in the cluster (nodes: ${nodes.map((entry) => entry.node).join(", ") || "none"})`
          : `the node "${layout.node}" is offline`,
        sentence("connect again with the name of an online node"),
      ),
    )
    return { ok: false, problems }
  }
  const lacking = [
    ...(
      await missingPrivileges(client, privilegePath.pool(layout.pool), POOL_PRIVILEGES, signal)
    ).map((privilege) => `${privilege} on ${privilegePath.pool(layout.pool)}`),
    ...(
      await missingPrivileges(
        client,
        privilegePath.storage(layout.storage),
        STORAGE_PRIVILEGES,
        signal,
      )
    ).map((privilege) => `${privilege} on ${privilegePath.storage(layout.storage)}`),
  ]
  if (lacking.length > 0) {
    problems.push(
      problem(
        "privilege-missing",
        `the API token ${target.tokenId} lacks ${lacking.join(", ")}`,
        admin,
      ),
    )
  }
  const pool = await client.pool(layout.pool, signal)
  const limits = pool === undefined ? undefined : poolLimitsOf(pool.comment)
  if (pool === undefined) {
    problems.push(
      problem(
        "pool-missing",
        `the pool "${layout.pool}" does not exist or is not visible to the token`,
        admin,
      ),
    )
  } else {
    if (limits === undefined) {
      problems.push(
        problem(
          "pool-limits-undeclared",
          `the comment of the pool "${layout.pool}" declares no limits for the bots ("${limitsLine({ cpus: 8, memoryMiB: 16384 })}")`,
          command(
            `pvesh set /pools/${layout.pool} --comment "${limitsLine({ cpus: 8, memoryMiB: 16384 })}"`,
          ),
        ),
      )
    }
    if (!pool.storages.includes(layout.storage)) {
      problems.push(
        problem(
          "storage-unusable",
          `the storage "${layout.storage}" is not a member of the pool "${layout.pool}"`,
          command(`pvesh set /pools/${layout.pool} --storage ${layout.storage}`),
        ),
      )
    }
  }
  const storage = await client.storage(layout.storage, signal)
  if (storage === undefined) {
    problems.push(
      problem(
        "storage-missing",
        `the storage "${layout.storage}" is not on the node "${layout.node}"`,
        admin,
      ),
    )
  } else {
    const missing = REQUIRED_CONTENT.filter((content) => !storage.content.includes(content))
    if (!storage.enabled || !storage.active) {
      problems.push(
        problem(
          "storage-unusable",
          `the storage "${layout.storage}" is not enabled and active`,
          command(`pvesm set ${layout.storage} --disable 0`),
        ),
      )
    }
    if (missing.length > 0) {
      problems.push(
        problem(
          "storage-unusable",
          `the storage "${layout.storage}" does not hold ${missing.join(", ")}`,
          command(
            `pvesm set ${layout.storage} --content ${[...new Set([...storage.content, ...REQUIRED_CONTENT])].join(",")}`,
          ),
        ),
      )
    }
  }
  if (!(await client.bridges(signal)).includes(layout.bridge)) {
    problems.push(
      problem(
        "bridge-missing",
        `the node "${layout.node}" has no bridge "${layout.bridge}"`,
        sentence("connect again with a bridge of the node"),
      ),
    )
  } else {
    const denied = await missingPrivileges(
      client,
      privilegePath.bridge(layout.bridge),
      BRIDGE_PRIVILEGES,
      signal,
    )
    if (denied.length > 0) {
      problems.push(
        problem(
          "bridge-denied",
          `the API token ${target.tokenId} may not attach VMs to the bridge "${layout.bridge}" (${denied.join(", ")} on ${privilegePath.bridge(layout.bridge)})`,
          admin,
        ),
      )
    }
  }
  if (pool !== undefined && problems.length === 0)
    problems.push(...(await guestProblems(target, signal)))
  if (problems.length > 0 || limits === undefined) return { ok: false, problems }
  const declaration: EnvironmentHostDeclaration = {
    kind: "proxmox",
    node: layout.node,
    pool: layout.pool,
    storage: layout.storage,
    bridge: layout.bridge,
    limits,
  }
  return { ok: true, declaration }
}

async function guestProblems(
  target: ProxmoxCheckTarget,
  signal?: AbortSignal,
): Promise<readonly EnvironmentHostProblem[]> {
  const running = (await target.inventory.vms(signal))
    .filter(
      (vm) => vm.meta?.kind === "bot" && vm.meta.owner === target.owner && vm.status === "running",
    )
    .slice(0, GUESTS_PROBED)
  const problems: EnvironmentHostProblem[] = []
  for (const vm of running) {
    let address: string
    try {
      address = await guestAddress(target.client, vm.vmid, vm.config.net0, signal)
    } catch {
      continue
    }
    try {
      await target.reach(address, SSH_PORT, signal)
    } catch (error) {
      problems.push(
        problem(
          "guest-unreachable",
          `this installation cannot reach the bot VM ${vm.name} at ${address}:${SSH_PORT}: ${messageOf(error)}`,
          sentence(
            `route the network of the bridge "${target.layout.bridge}" to this host, and check that the VMs see this host as ${target.layout.sshSource}`,
          ),
        ),
      )
    }
  }
  return problems
}
