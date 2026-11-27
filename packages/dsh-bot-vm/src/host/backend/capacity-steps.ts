import type { BotEnvironmentRange } from "@1outres/dsh-bot-core"

export const MIN_MEMORY_MIB = 1024
export const MEMORY_STEP_MIB = 512
export const MIN_DISK_GIB = 1

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
