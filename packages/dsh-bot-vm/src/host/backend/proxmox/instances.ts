import type {
  InstanceBackend,
  InstanceChange,
  InstanceRecord,
  InstanceShape,
  InstanceStatus,
} from "../contract"
import type { ProxmoxClient, ProxmoxParams } from "./client"
import type { ProxmoxLayout } from "./endpoint"
import type { Images } from "./images"
import type { Inventory, PoolVm } from "./inventory"
import {
  baseTemplateOf,
  gibText,
  macOf,
  NIC,
  nicValue,
  ROOT_DISK,
  SEED_DRIVE,
  seedFile,
  seedValue,
  seedVolid,
  sizeBytesOfDisk,
  volidOfDisk,
  WORKSPACE_DISK,
  workspaceValue,
} from "./layout"
import { type BotMeta, descriptionOf } from "./meta"
import { writeFirewall } from "./network"
import { emptySeedOf, seedOf } from "./seed"
import { withNewVmid } from "./vmid"
import type { Workspaces } from "./workspaces"

export interface InstancesOptions {
  readonly client: ProxmoxClient
  readonly inventory: Inventory
  readonly images: Images
  readonly workspaces: Workspaces
  readonly layout: ProxmoxLayout
  readonly uploadTimeoutMs: number
  readonly now: () => Date
}

const GIB = 1024 ** 3
const STATUS: Readonly<Record<string, InstanceStatus>> = {
  running: "running",
  stopped: "stopped",
  paused: "frozen",
  suspended: "frozen",
}

const whole = (value: string | undefined) => {
  const number = value === undefined ? Number.NaN : Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

const botMetaOf = (vm: PoolVm): BotMeta | undefined =>
  vm.meta?.kind === "bot" ? vm.meta : undefined

const titleOf = (description: string) =>
  `${description} (made by dsh-bots; do not edit the line below)`

export interface Instances extends InstanceBackend {
  vmidOf(name: string, signal?: AbortSignal): Promise<number>
}

export function createInstances(options: InstancesOptions): Instances {
  const { client, inventory, layout } = options

  async function statusOf(vm: PoolVm, signal?: AbortSignal): Promise<string> {
    const current = await client.status(vm.vmid, signal)
    return current.qmpstatus ?? current.status
  }

  function recordOf(vm: PoolVm, status: string): InstanceRecord {
    const meta = botMetaOf(vm)
    const memoryMiB = whole(vm.config.memory)
    return {
      name: vm.name,
      botId: meta?.botId,
      owner: meta?.owner,
      orphanedSince: meta?.orphanedSince,
      status: STATUS[status] ?? "other",
      statusText: status,
      cpus: (whole(vm.config.cores) ?? 1) * (whole(vm.config.sockets) ?? 1),
      memoryMiB,
    }
  }

  async function found(name: string, signal?: AbortSignal): Promise<PoolVm> {
    const vm = await inventory.bot(name, signal)
    if (vm === undefined) throw new Error(`the Proxmox VM "${name}" disappeared`)
    return vm
  }

  async function desired(shape: InstanceShape, signal?: AbortSignal) {
    return {
      cores: shape.resources.cpus,
      memory: shape.resources.memoryMiB,
      workspace: await options.workspaces.volid(shape.workspace, signal),
      rootBytes: shape.resources.rootDiskGiB * GIB,
    }
  }

  async function plan(shape: InstanceShape, signal?: AbortSignal) {
    const vm = await found(shape.name, signal)
    const want = await desired(shape, signal)
    const config: Record<string, string | number> = {}
    if (whole(vm.config.cores) !== want.cores || (whole(vm.config.sockets) ?? 1) !== 1) {
      config.cores = want.cores
      config.sockets = 1
    }
    if (whole(vm.config.memory) !== want.memory) config.memory = want.memory
    const attached = vm.config[WORKSPACE_DISK]
    if (attached === undefined || volidOfDisk(attached) !== want.workspace) {
      config[WORKSPACE_DISK] = workspaceValue(want.workspace)
    }
    const rootBytes = sizeBytesOfDisk(vm.config[ROOT_DISK])
    if (rootBytes === undefined)
      throw new Error(`cannot read the size of ${ROOT_DISK} of VM ${vm.vmid}`)
    const grow = rootBytes < want.rootBytes ? shape.resources.rootDiskGiB : undefined
    return { vm, config, grow }
  }

  async function uploadSeed(name: string, seed: Uint8Array, signal?: AbortSignal): Promise<void> {
    await client.upload(
      layout.storage,
      "iso",
      {
        name: seedFile(name),
        bytes: seed.length,
        body: (async function* () {
          yield seed
        })(),
      },
      options.uploadTimeoutMs,
      signal,
    )
  }

  async function blankSeed(vm: PoolVm, signal?: AbortSignal): Promise<void> {
    const mac = macOf(vm.config[NIC])
    if (mac === undefined) return
    await uploadSeed(
      vm.name,
      emptySeedOf(
        { instance: vm.name, vmid: vm.vmid, mac, nameservers: layout.nameservers },
        options.now(),
      ),
      signal,
    )
  }

  async function writeMeta(vm: PoolVm, meta: BotMeta, signal?: AbortSignal): Promise<void> {
    const title = vm.config.description?.split("\n")[0] ?? vm.name
    await client.configure(vm.vmid, { description: descriptionOf(title, meta) }, signal)
  }

  return {
    async vmidOf(name, signal) {
      return (await found(name, signal)).vmid
    },
    async list(owner, signal) {
      const vms = (await inventory.vms(signal)).filter(
        (vm) => !vm.template && botMetaOf(vm)?.owner === owner,
      )
      return vms.map((vm) => recordOf(vm, vm.status))
    },
    async get(name, signal) {
      const vm = await inventory.bot(name, signal)
      return vm === undefined ? undefined : recordOf(vm, await statusOf(vm, signal))
    },
    async create(spec, signal) {
      const template = await options.images.template(spec.image, signal)
      const workspace = await options.workspaces.volid(spec.workspace, signal)
      const vmid = await withNewVmid(
        client,
        (id) =>
          client.clone(
            template,
            { newid: id, name: spec.name, pool: layout.pool, full: 0 },
            signal,
          ),
        signal,
      )
      const cloned = await client.config(vmid, signal)
      const mac = macOf(cloned[NIC])
      if (mac === undefined)
        throw new Error(`the clone ${vmid} of template ${template} has no virtio ${NIC}`)
      const seed = seedOf(
        {
          instance: spec.name,
          vmid,
          mac,
          nameservers: layout.nameservers,
          userData: spec.userData,
        },
        options.now(),
      )
      await uploadSeed(spec.name, seed, signal)
      const meta: BotMeta = { kind: "bot", owner: spec.owner, botId: spec.botId }
      const params: ProxmoxParams = {
        cores: spec.resources.cpus,
        sockets: 1,
        memory: spec.resources.memoryMiB,
        description: descriptionOf(titleOf(spec.description), meta),
        [NIC]: nicValue(mac, layout.bridge),
        [WORKSPACE_DISK]: workspaceValue(workspace),
        [SEED_DRIVE]: seedValue(seedVolid(layout.storage, spec.name)),
        agent: "enabled=1",
        onboot: 1,
      }
      await client.configure(vmid, params, signal)
      const rootBytes = sizeBytesOfDisk(cloned[ROOT_DISK])
      if (rootBytes === undefined || rootBytes < spec.resources.rootDiskGiB * GIB) {
        await client.resize(vmid, ROOT_DISK, gibText(spec.resources.rootDiskGiB), signal)
      }
      await writeFirewall(client, vmid, layout, signal)
    },
    async change(shape, signal): Promise<InstanceChange> {
      const { config, grow } = await plan(shape, signal)
      const what = [
        ...Object.entries(config)
          .filter(([key]) => key !== "sockets")
          .map(([key, value]) => (key === WORKSPACE_DISK ? "workspace disk" : `${key} ${value}`)),
        ...(grow === undefined ? [] : [`${ROOT_DISK} ${gibText(grow)}`]),
      ]
      if (what.length === 0) return { kind: "none" }
      return { kind: Object.keys(config).length > 0 ? "restart" : "live", what }
    },
    async conform(shape, signal) {
      const { vm, config, grow } = await plan(shape, signal)
      if (Object.keys(config).length > 0) await client.configure(vm.vmid, config, signal)
      if (grow !== undefined) await client.resize(vm.vmid, ROOT_DISK, gibText(grow), signal)
    },
    async start(name, signal) {
      const vm = await found(name, signal)
      const status = await statusOf(vm, signal)
      if (status === "running") return
      await client.power(vm.vmid, STATUS[status] === "frozen" ? "resume" : "start", signal)
    },
    async settle(name, signal) {
      const vm = await found(name, signal)
      if (vm.config[SEED_DRIVE] === undefined) return
      await blankSeed(vm, signal)
      await client.configure(vm.vmid, { delete: SEED_DRIVE }, signal)
    },
    async stop(name, signal) {
      const vm = await found(name, signal)
      if ((await statusOf(vm, signal)) !== "stopped")
        await client.power(vm.vmid, "shutdown", signal)
    },
    async remove(name, signal) {
      const vm = await found(name, signal)
      if ((await statusOf(vm, signal)) !== "stopped")
        await client.power(vm.vmid, "shutdown", signal)
      if (vm.config[WORKSPACE_DISK] !== undefined) {
        await client.configure(vm.vmid, { delete: WORKSPACE_DISK }, signal)
      }
      if (vm.config[SEED_DRIVE] !== undefined) await blankSeed(vm, signal)
      await client.destroy(vm.vmid, signal)
      const template = baseTemplateOf(vm.config)
      if (template !== undefined) await options.images.release(template, signal)
    },
    async markOrphaned(name, since, signal) {
      const vm = await found(name, signal)
      const meta = botMetaOf(vm)
      if (meta === undefined)
        throw new Error(`the Proxmox VM "${name}" is not a bot VM of dsh-bots`)
      const { orphanedSince: _, ...rest } = meta
      await writeMeta(vm, since === undefined ? rest : { ...rest, orphanedSince: since }, signal)
    },
  }
}
