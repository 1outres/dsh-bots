import type { BotEnvironmentCapacity } from "@1outres/dsh-bot-core"
import { GIB, MIB, sizeBytesOf } from "./spec"

export const MIN_MEMORY_MIB = 1024
export const MEMORY_STEP_MIB = 512
export const MIN_DISK_GIB = 1
export const HOST_MEMORY_SHARE = 3 / 4

export interface CapacityInputs {
  readonly hostCpus: number
  readonly hostMemoryBytes: number
  readonly project: Readonly<Record<string, string>>
  readonly othersMemoryBytes: number
  readonly pool: string
  readonly poolBytes: number
  readonly rootDiskGiB: number
}

export function capacityOf(inputs: CapacityInputs): BotEnvironmentCapacity {
  const { project } = inputs
  const projectCpus = /^\d+$/.test(project["limits.cpu"] ?? "")
    ? Number(project["limits.cpu"])
    : Number.POSITIVE_INFINITY
  const projectMemory = sizeBytesOf(project["limits.memory"])
  const memoryBytes = Math.min(
    inputs.hostMemoryBytes * HOST_MEMORY_SHARE,
    projectMemory === undefined
      ? Number.POSITIVE_INFINITY
      : projectMemory - inputs.othersMemoryBytes,
  )
  const diskBytes = Math.min(
    inputs.poolBytes,
    sizeBytesOf(project["limits.disk"]) ?? Number.POSITIVE_INFINITY,
    sizeBytesOf(project[`limits.disk.pool.${inputs.pool}`]) ?? Number.POSITIVE_INFINITY,
  )
  return {
    cpus: { min: 1, max: Math.floor(Math.min(inputs.hostCpus, projectCpus)), step: 1 },
    memoryMiB: {
      min: MIN_MEMORY_MIB,
      max: Math.floor(memoryBytes / MIB / MEMORY_STEP_MIB) * MEMORY_STEP_MIB,
      step: MEMORY_STEP_MIB,
    },
    diskGiB: {
      min: MIN_DISK_GIB,
      max: Math.floor(diskBytes / GIB) - inputs.rootDiskGiB,
      step: 1,
      growOnly: true,
    },
  }
}
