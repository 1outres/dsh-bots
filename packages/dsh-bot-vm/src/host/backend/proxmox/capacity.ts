import type { BotEnvironmentCapacity, ProxmoxPoolLimits } from "@1outres/dsh-bot-core"
import { MEMORY_STEP_MIB, MIN_DISK_GIB, MIN_MEMORY_MIB } from "../capacity-steps"

const MIB = 1024 ** 2
const GIB = 1024 ** 3

export interface ProxmoxCapacityInputs {
  readonly limits: ProxmoxPoolLimits
  readonly othersMemoryBytes: number
  readonly storageAvailBytes: number
  readonly rootDiskGiB: number
}

export function proxmoxCapacityOf(inputs: ProxmoxCapacityInputs): BotEnvironmentCapacity {
  const memoryBytes = inputs.limits.memoryMiB * MIB - inputs.othersMemoryBytes
  return {
    cpus: { min: 1, max: inputs.limits.cpus, step: 1 },
    memoryMiB: {
      min: MIN_MEMORY_MIB,
      max: Math.floor(memoryBytes / MIB / MEMORY_STEP_MIB) * MEMORY_STEP_MIB,
      step: MEMORY_STEP_MIB,
    },
    diskGiB: {
      min: MIN_DISK_GIB,
      max: Math.floor(inputs.storageAvailBytes / GIB) - inputs.rootDiskGiB,
      step: 1,
      growOnly: true,
    },
  }
}
