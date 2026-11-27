import type { BotEnvironmentAllowance } from "@1outres/dsh-bot-core"
import { cpuRange, memoryRange, workspaceRange } from "../capacity-steps"
import type { IncusHostResources, IncusInstance, IncusProjectState } from "./client"
import { GIB, INCUS_VM_DEFAULT_STATE_BYTES, instanceSizesOf, sizeBytesOf } from "./sizes"

export const HOST_MEMORY_SHARE = 3 / 4

export interface IncusAllocation {
  readonly cpus: number
  readonly memoryBytes: number
  readonly diskBytes: number
}

export interface CapacityInputs {
  readonly project: string
  readonly host: IncusHostResources
  readonly pool: string
  readonly poolBytes: number
  readonly state: IncusProjectState
  readonly instance: IncusAllocation | undefined
  readonly workspaceBytes: number | undefined
  readonly rootDiskGiB: number
}

const INSTANCE_COUNTS = [
  { resource: "virtual-machines", key: "limits.virtual-machines", noun: "VMs" },
  { resource: "instances", key: "limits.instances", noun: "instances" },
] as const

export function allocationOf(instance: IncusInstance): IncusAllocation {
  const sizes = instanceSizesOf(instance)
  const root = Object.values(instance.expanded_devices ?? instance.devices).find(
    (device) => device.type === "disk" && device.path === "/",
  )
  const rootBytes = sizeBytesOf(root?.size)
  const stateText = root?.["size.state"]
  const stateSize = stateText === undefined ? INCUS_VM_DEFAULT_STATE_BYTES : sizeBytesOf(stateText)
  if (sizes.cpus === undefined || sizes.memoryBytes === undefined) {
    throw new Error(`cannot read the CPUs and memory of Incus instance "${instance.name}"`)
  }
  if (rootBytes === undefined || stateSize === undefined) {
    throw new Error(`cannot read the root disk size of Incus instance "${instance.name}"`)
  }
  return { cpus: sizes.cpus, memoryBytes: sizes.memoryBytes, diskBytes: rootBytes + stateSize }
}

export function capacityOf(inputs: CapacityInputs): BotEnvironmentAllowance {
  const { state, instance } = inputs
  const left = (resource: string, own: number) => {
    const quota = state[resource]
    return quota?.limit === undefined ? Number.POSITIVE_INFINITY : quota.limit - quota.usage + own
  }
  if (instance === undefined) {
    const full = INSTANCE_COUNTS.find((count) => left(count.resource, 0) < 1)
    if (full !== undefined) {
      return {
        status: "full",
        reason: `the Incus project "${inputs.project}" already has ${state[full.resource]?.usage} ${full.noun}, as many as its ${full.key} allows`,
      }
    }
  }
  const ownDisk = (instance?.diskBytes ?? 0) + (inputs.workspaceBytes ?? 0)
  const diskBytes = Math.min(
    inputs.poolBytes,
    left("disk", ownDisk),
    left(`disk.${inputs.pool}`, ownDisk),
  )
  const currentGiB =
    inputs.workspaceBytes === undefined ? undefined : Math.floor(inputs.workspaceBytes / GIB)
  return {
    status: "ready",
    capacity: {
      cpus: cpuRange(Math.min(inputs.host.cpus, left("cpu", instance?.cpus ?? 0))),
      memoryMiB: memoryRange(
        Math.min(
          inputs.host.memoryBytes * HOST_MEMORY_SHARE,
          left("memory", instance?.memoryBytes ?? 0),
        ),
      ),
      diskGiB: workspaceRange(
        Math.floor((diskBytes - INCUS_VM_DEFAULT_STATE_BYTES) / GIB) - inputs.rootDiskGiB,
        currentGiB,
      ),
    },
  }
}
