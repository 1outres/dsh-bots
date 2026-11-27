import type { PoolMember, ProxmoxClient, VmConfig } from "./client"
import { isNotFound } from "./client"
import { type BotMeta, type ImageMeta, metaOf, type VmMeta, type VolumesMeta } from "./meta"

export interface PoolVm {
  readonly vmid: number
  readonly name: string
  readonly status: string
  readonly template: boolean
  readonly maxcpu: number | undefined
  readonly maxmem: number | undefined
  readonly config: VmConfig
  readonly meta: VmMeta | undefined
}

export type Owned<M extends VmMeta> = PoolVm & { readonly meta: M }

export interface Inventory {
  vms(signal?: AbortSignal): Promise<readonly PoolVm[]>
  vm(vmid: number, signal?: AbortSignal): Promise<PoolVm | undefined>
  bot(name: string, signal?: AbortSignal): Promise<PoolVm | undefined>
  holder(signal?: AbortSignal): Promise<Owned<VolumesMeta> | undefined>
  images(signal?: AbortSignal): Promise<readonly Owned<ImageMeta>[]>
}

export interface InventoryOptions {
  readonly client: ProxmoxClient
  readonly pool: string
  readonly owner: string
}

const isMeta =
  <K extends VmMeta["kind"]>(kind: K, owner: string) =>
  (vm: PoolVm): vm is Owned<Extract<VmMeta, { kind: K }>> =>
    vm.meta?.kind === kind && vm.meta.owner === owner

export const isBot = (vm: PoolVm): vm is Owned<BotMeta> => vm.meta?.kind === "bot"

export function createInventory(options: InventoryOptions): Inventory {
  const { client, pool, owner } = options

  async function withConfig(member: PoolMember, signal?: AbortSignal): Promise<PoolVm | undefined> {
    let config: VmConfig
    try {
      config = await client.config(member.vmid, signal)
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
    return {
      vmid: member.vmid,
      name: config.name ?? member.name,
      status: member.status,
      template: config.template === "1",
      maxcpu: member.maxcpu,
      maxmem: member.maxmem,
      config,
      meta: metaOf(config.description),
    }
  }

  async function members(signal?: AbortSignal): Promise<readonly PoolMember[]> {
    const found = await client.pool(pool, signal)
    if (found === undefined)
      throw new Error(
        `the Proxmox pool "${pool}" does not exist or is not visible to the API token`,
      )
    return found.vms
  }

  async function vms(signal?: AbortSignal): Promise<readonly PoolVm[]> {
    const all = await Promise.all(
      (await members(signal)).map((member) => withConfig(member, signal)),
    )
    return all.filter((vm): vm is PoolVm => vm !== undefined)
  }

  function single<T extends PoolVm>(found: readonly T[], what: string): T | undefined {
    if (found.length > 1) {
      throw new Error(
        `the Proxmox pool "${pool}" has ${found.length} ${what} (VMs ${found.map((vm) => vm.vmid).join(", ")}); remove all but one`,
      )
    }
    return found[0]
  }

  return {
    vms,
    async vm(vmid, signal) {
      const member = (await members(signal)).find((entry) => entry.vmid === vmid)
      return member === undefined ? undefined : withConfig(member, signal)
    },
    async bot(name, signal) {
      const named = (await vms(signal)).filter(
        (vm) =>
          vm.name === name &&
          !vm.template &&
          vm.meta?.kind !== "volumes" &&
          vm.meta?.kind !== "image",
      )
      return single(named, `VMs named "${name}"`)
    },
    async holder(signal) {
      return single(
        (await vms(signal)).filter(isMeta("volumes", owner)),
        "workspace holders of this installation",
      )
    },
    async images(signal) {
      return (await vms(signal)).filter((vm) => vm.template).filter(isMeta("image", owner))
    },
  }
}
