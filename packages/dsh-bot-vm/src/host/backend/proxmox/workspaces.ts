import type { WorkspaceBackend, WorkspaceRecord } from "../contract"
import type { ProxmoxClient, StorageVolume } from "./client"
import type { Inventory, Owned, PoolVm } from "./inventory"
import {
  diskEntries,
  gibText,
  holderParams,
  virtioSlots,
  volidOfDisk,
  workspaceFile,
  workspaceNameOf,
  workspaceVolid,
} from "./layout"
import { descriptionOf, type VolumeMeta, type VolumesMeta } from "./meta"
import { withNewVmid } from "./vmid"

export interface Workspaces extends WorkspaceBackend {
  volid(name: string, signal?: AbortSignal): Promise<string>
}

export interface WorkspacesOptions {
  readonly client: ProxmoxClient
  readonly inventory: Inventory
  readonly pool: string
  readonly storage: string
  readonly owner: string
}

const GIB = 1024 ** 3
const UNUSED = /^unused\d+$/
const HOLDER_TITLE = "dsh-bots: holds the bots' workspace disks; never start or delete it"

export const holderNameOf = (owner: string) => `dsh-bots-volumes-${owner.slice(0, 12)}`

export function createWorkspaces(options: WorkspacesOptions): Workspaces {
  const { client, inventory, storage, owner } = options
  let queue: Promise<unknown> = Promise.resolve()

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work)
    queue = run.catch(() => {})
    return run
  }

  async function holder(signal?: AbortSignal): Promise<Owned<VolumesMeta>> {
    const found = await inventory.holder(signal)
    if (found !== undefined) return found
    const meta: VolumesMeta = { kind: "volumes", owner, volumes: {} }
    const vmid = await withNewVmid(
      client,
      (id) =>
        client.createVm(
          holderParams({
            vmid: id,
            name: holderNameOf(owner),
            pool: options.pool,
            description: descriptionOf(HOLDER_TITLE, meta),
          }),
          signal,
        ),
      signal,
    )
    const created = await inventory.vm(vmid, signal)
    if (created === undefined) throw new Error(`the workspace holder VM ${vmid} disappeared`)
    return { ...created, meta }
  }

  async function writeVolumes(
    change: (volumes: Record<string, VolumeMeta>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const found = await holder(signal)
    const volumes = { ...found.meta.volumes }
    change(volumes)
    await client.configure(
      found.vmid,
      { description: descriptionOf(HOLDER_TITLE, { ...found.meta, volumes }) },
      signal,
    )
  }

  const references = (vm: PoolVm, volid: string) =>
    diskEntries(vm.config).filter(([, value]) => volidOfDisk(value) === volid)

  function recordOf(
    found: Owned<VolumesMeta>,
    volume: StorageVolume,
    name: string,
    others: readonly PoolVm[],
  ): WorkspaceRecord {
    const meta = found.meta.volumes[name]
    return {
      name,
      botId: meta?.botId,
      owner: meta === undefined ? undefined : owner,
      orphanedSince: meta?.orphanedSince,
      block: true,
      sizeBytes: volume.sizeBytes,
      sizeText: volume.sizeBytes === undefined ? "" : `${volume.sizeBytes / GIB}GiB`,
      attached: others.some((vm) => references(vm, volume.volid).length > 0),
    }
  }

  async function records(signal?: AbortSignal): Promise<readonly WorkspaceRecord[]> {
    const vms = await inventory.vms(signal)
    const found = vms.find(
      (vm): vm is Owned<VolumesMeta> => vm.meta?.kind === "volumes" && vm.meta.owner === owner,
    )
    if (found === undefined) return []
    const others = vms.filter((vm) => vm.vmid !== found.vmid)
    const volumes = await client.volumes(storage, { content: "images", vmid: found.vmid }, signal)
    return volumes.flatMap((volume) => {
      const name = workspaceNameOf(found.vmid, volume.volid)
      return name === undefined ? [] : [recordOf(found, volume, name, others)]
    })
  }

  async function freeSlot(vm: PoolVm, signal?: AbortSignal): Promise<string> {
    const config = (await inventory.vm(vm.vmid, signal))?.config ?? vm.config
    const slot = virtioSlots().find((key) => config[key] === undefined)
    if (slot === undefined)
      throw new Error(`the workspace holder VM ${vm.vmid} has no free virtio slot`)
    return slot
  }

  async function holderKey(found: Owned<VolumesMeta>, volid: string, signal?: AbortSignal) {
    const config = (await inventory.vm(found.vmid, signal))?.config ?? {}
    return Object.entries(config).find(
      ([key, value]) =>
        (UNUSED.test(key) || key.startsWith("virtio")) && volidOfDisk(value) === volid,
    )?.[0]
  }

  return {
    async volid(name, signal) {
      const found = await inventory.holder(signal)
      if (found === undefined) throw new Error(`the workspace disk "${name}" does not exist`)
      return workspaceVolid(storage, found.vmid, name)
    },
    list: async (wanted, signal) =>
      (await records(signal)).filter((record) => record.owner === wanted),
    get: async (name, signal) => (await records(signal)).find((record) => record.name === name),
    async create(spec, signal) {
      const found = await exclusive(async () => {
        await writeVolumes((volumes) => {
          volumes[spec.name] = { botId: spec.botId }
        }, signal)
        return holder(signal)
      })
      await client.allocate(
        storage,
        {
          vmid: found.vmid,
          filename: workspaceFile(found.vmid, spec.name),
          size: gibText(spec.sizeGiB),
          format: "raw",
        },
        signal,
      )
    },
    async grow(name, sizeGiB, signal) {
      const found = await holder(signal)
      const volid = workspaceVolid(storage, found.vmid, name)
      const user = (await inventory.vms(signal))
        .filter((vm) => vm.vmid !== found.vmid)
        .flatMap((vm) => references(vm, volid).map(([key]) => ({ vm, key })))[0]
      if (user !== undefined) {
        await client.resize(user.vm.vmid, user.key, gibText(sizeGiB), signal)
        return
      }
      await exclusive(async () => {
        const slot = await freeSlot(found, signal)
        await client.configure(found.vmid, { [slot]: volid }, signal)
        try {
          await client.resize(found.vmid, slot, gibText(sizeGiB), signal)
        } finally {
          await client.configure(found.vmid, { delete: slot }, signal)
        }
      })
    },
    markOrphaned: (name, since, signal) =>
      exclusive(() =>
        writeVolumes((volumes) => {
          const entry = volumes[name]
          if (entry === undefined)
            throw new Error(`the workspace disk "${name}" is not this installation's`)
          volumes[name] =
            since === undefined
              ? { botId: entry.botId }
              : { botId: entry.botId, orphanedSince: since }
        }, signal),
      ),
    remove: (name, signal) =>
      exclusive(async () => {
        const found = await holder(signal)
        const volid = workspaceVolid(storage, found.vmid, name)
        const users = (await inventory.vms(signal)).filter(
          (vm) => vm.vmid !== found.vmid && references(vm, volid).length > 0,
        )
        if (users.length > 0) {
          throw new Error(
            `the workspace disk ${volid} is attached to VM ${users.map((vm) => vm.vmid).join(", ")}; it was not deleted`,
          )
        }
        let key = await holderKey(found, volid, signal)
        if (key === undefined) {
          key = await freeSlot(found, signal)
          await client.configure(found.vmid, { [key]: volid }, signal)
        }
        if (!UNUSED.test(key)) {
          await client.configure(found.vmid, { delete: key }, signal)
          key = await holderKey(found, volid, signal)
          if (key === undefined || !UNUSED.test(key)) {
            throw new Error(
              `Proxmox did not keep ${volid} as an unused disk of VM ${found.vmid}; it was not deleted`,
            )
          }
        }
        await client.configure(found.vmid, { delete: key }, signal)
        await writeVolumes((volumes) => {
          delete volumes[name]
        }, signal)
      }),
  }
}
