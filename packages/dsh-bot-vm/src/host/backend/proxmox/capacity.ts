import type { BotEnvironmentAllowance, ProxmoxPoolLimits } from "@1outres/dsh-bot-core"
import { cpuRange, memoryRange, workspaceRange } from "../capacity-steps"
import type { PoolVm } from "./inventory"

const MIB = 1024 ** 2
const GIB = 1024 ** 3

export interface ProxmoxAllocation {
  readonly cpus: number
  readonly memoryBytes: number
}

export interface ProxmoxCapacityInputs {
  readonly limits: ProxmoxPoolLimits
  readonly others: ProxmoxAllocation
  readonly storageAvailBytes: number
  readonly rootDiskGiB: number
  readonly workspaceBytes: number | undefined
  readonly instanceExists: boolean
}

export function allocationOf(vm: PoolVm): ProxmoxAllocation {
  if (vm.maxcpu === undefined || vm.maxmem === undefined) {
    throw new Error(`cannot read the CPUs and memory of the Proxmox VM ${vm.vmid} ("${vm.name}")`)
  }
  return { cpus: vm.maxcpu, memoryBytes: vm.maxmem }
}

export const totalOf = (allocations: readonly ProxmoxAllocation[]): ProxmoxAllocation => ({
  cpus: allocations.reduce((sum, allocation) => sum + allocation.cpus, 0),
  memoryBytes: allocations.reduce((sum, allocation) => sum + allocation.memoryBytes, 0),
})

export function proxmoxCapacityOf(inputs: ProxmoxCapacityInputs): BotEnvironmentAllowance {
  const { limits, others, workspaceBytes } = inputs
  const currentGiB = workspaceBytes === undefined ? undefined : Math.floor(workspaceBytes / GIB)
  return {
    status: "ready",
    capacity: {
      cpus: cpuRange(limits.cpus - others.cpus),
      memoryMiB: memoryRange(limits.memoryMiB * MIB - others.memoryBytes),
      diskGiB: workspaceRange(
        Math.floor(inputs.storageAvailBytes / GIB) +
          (currentGiB ?? 0) -
          (inputs.instanceExists ? 0 : inputs.rootDiskGiB),
        currentGiB,
      ),
    },
  }
}
