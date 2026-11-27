import type { CapacityRequest, GuestChannel, VmBackend } from "../contract"
import { proxmoxCapacityOf } from "./capacity"
import { checkProxmox, type GuestReach } from "./check"
import type { ProxmoxClient } from "./client"
import type { ProxmoxLayout } from "./endpoint"
import { createImages, type ImageUnpacker } from "./images"
import { createInstances } from "./instances"
import { createInventory } from "./inventory"
import { SSH_PORT, WORKSPACE_BY_ID } from "./layout"
import { poolLimitsOf } from "./limits"
import { guestAddress, pinAddress } from "./network"
import { createWorkspaces } from "./workspaces"

export type GuestConnect = (
  host: string,
  port: number,
  signal?: AbortSignal,
) => Promise<GuestChannel>

export interface ProxmoxBackendOptions {
  readonly client: ProxmoxClient
  readonly url: string
  readonly tokenId: string
  readonly layout: ProxmoxLayout
  readonly owner: string
  readonly uploadTimeoutMs: number
  readonly unpack: ImageUnpacker
  readonly connect: GuestConnect
  readonly reach: GuestReach
  readonly now: () => Date
}

export const proxmoxPlace = (layout: Pick<ProxmoxLayout, "node" | "pool">) =>
  `${layout.pool}@${layout.node}`

export function createProxmoxBackend(options: ProxmoxBackendOptions): VmBackend {
  const { client, layout, owner } = options
  const inventory = createInventory({ client, pool: layout.pool, owner })
  const workspaces = createWorkspaces({
    client,
    inventory,
    pool: layout.pool,
    storage: layout.storage,
    owner,
  })
  const images = createImages({
    client,
    inventory,
    pool: layout.pool,
    storage: layout.storage,
    bridge: layout.bridge,
    owner,
    uploadTimeoutMs: options.uploadTimeoutMs,
    unpack: options.unpack,
  })
  const instances = createInstances({
    client,
    inventory,
    images,
    workspaces,
    layout,
    uploadTimeoutMs: options.uploadTimeoutMs,
    now: options.now,
  })

  async function capacity(request: CapacityRequest, signal?: AbortSignal) {
    const [pool, storage, vms] = await Promise.all([
      client.pool(layout.pool, signal),
      client.storage(layout.storage, signal),
      inventory.vms(signal),
    ])
    const limits = pool === undefined ? undefined : poolLimitsOf(pool.comment)
    if (limits === undefined)
      throw new Error(`the pool "${layout.pool}" declares no limits for the bots`)
    if (storage === undefined) throw new Error(`the storage "${layout.storage}" cannot be read`)
    const othersMemoryBytes = vms
      .filter((vm) => !vm.template && vm.meta?.kind !== "volumes" && vm.name !== request.instance)
      .reduce((sum, vm) => sum + (vm.maxmem ?? 0), 0)
    return proxmoxCapacityOf({
      limits,
      othersMemoryBytes,
      storageAvailBytes: storage.availBytes,
      rootDiskGiB: request.rootDiskGiB,
    })
  }

  return {
    kind: "proxmox",
    where: `the Proxmox pool "${layout.pool}" on node ${layout.node}`,
    workspaceDevice: WORKSPACE_BY_ID,
    check: (signal) =>
      checkProxmox(
        {
          client,
          inventory,
          layout,
          url: options.url,
          tokenId: options.tokenId,
          owner,
          reach: options.reach,
        },
        signal,
      ),
    capacity,
    instances,
    workspaces,
    images,
    guest: {
      sshd: "listening",
      async open(instance, signal) {
        const vm = await inventory.bot(instance, signal)
        if (vm === undefined) throw new Error(`the Proxmox VM "${instance}" does not exist`)
        const address = await guestAddress(client, vm.vmid, vm.config.net0, signal)
        await pinAddress(client, vm.vmid, address, signal)
        try {
          return await options.connect(address, SSH_PORT, signal)
        } catch (error) {
          throw new Error(
            `cannot reach ${instance} at ${address}:${SSH_PORT} from this host (route the VM network of the bridge "${layout.bridge}" here): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      },
    },
  }
}
