import type { BotEnvironmentRange } from "@1outres/dsh-bot-core"

export const MIN_MEMORY_MIB = 1024
export const MEMORY_STEP_MIB = 512
export const MIN_DISK_GIB = 1

const MIB = 1024 ** 2

export const cpuRange = (most: number): BotEnvironmentRange => ({
  min: 1,
  max: Math.floor(most),
  step: 1,
})

export const memoryRange = (mostBytes: number): BotEnvironmentRange => ({
  min: MIN_MEMORY_MIB,
  max: Math.floor(mostBytes / MIB / MEMORY_STEP_MIB) * MEMORY_STEP_MIB,
  step: MEMORY_STEP_MIB,
})

export function workspaceRange(
  ceilingGiB: number,
  currentGiB: number | undefined,
): BotEnvironmentRange {
  const floor = currentGiB ?? 0
  return {
    min: Math.max(MIN_DISK_GIB, floor),
    max: Math.max(ceilingGiB, floor),
    step: 1,
    growOnly: true,
  }
}
