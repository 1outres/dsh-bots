/**
 * What a bot's VM may be given on this Host (pure; the environment reads the
 * inputs from Incus):
 * - CPUs: 1 to the Host's logical CPUs (a VM's vCPUs share them).
 * - Memory: 1 GiB to three quarters of the Host's memory, and no more than
 *   what the Incus project's `limits.memory` (a total over its instances)
 *   leaves beside the other instances, in steps of 512 MiB.
 * - Disk: 10 GiB (the base image's root file system holds about 4.3 GiB) to
 *   the size of the storage pool the root disk is on; it only grows.
 */
import type { BotEnvironmentCapacity } from "@1outres/dsh-bot-core"
import { sizeBytesOf } from "./spec"

export const MIN_MEMORY_MIB = 1024
export const MEMORY_STEP_MIB = 512
export const MIN_DISK_GIB = 10
/** The share of the Host's memory one VM may have; the rest stays for the Host and the other VMs. */
export const HOST_MEMORY_SHARE = 3 / 4

export interface CapacityInputs {
  readonly hostCpus: number
  readonly hostMemoryBytes: number
  /** The project's `limits.memory`, when it sets one. */
  readonly projectMemory: string | undefined
  /** The memory the project's other instances are given, together. */
  readonly othersMemoryBytes: number
  readonly poolBytes: number
}

const MIB = 1024 ** 2
const GIB = 1024 ** 3

export function capacityOf(inputs: CapacityInputs): BotEnvironmentCapacity {
  const project = sizeBytesOf(inputs.projectMemory)
  const memoryBytes = Math.min(
    inputs.hostMemoryBytes * HOST_MEMORY_SHARE,
    project === undefined ? Number.POSITIVE_INFINITY : project - inputs.othersMemoryBytes,
  )
  return {
    cpus: { min: 1, max: Math.floor(inputs.hostCpus), step: 1 },
    memoryMiB: {
      min: MIN_MEMORY_MIB,
      max: Math.floor(memoryBytes / MIB / MEMORY_STEP_MIB) * MEMORY_STEP_MIB,
      step: MEMORY_STEP_MIB,
    },
    diskGiB: {
      min: MIN_DISK_GIB,
      max: Math.floor(inputs.poolBytes / GIB),
      step: 1,
      growOnly: true,
    },
  }
}
