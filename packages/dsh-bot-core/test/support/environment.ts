import type { BotEnvironmentAllowance, BotEnvironmentCapacity } from "../../src/shared/environment"

export const TEST_CAPACITY: BotEnvironmentCapacity = {
  cpus: { min: 1, max: 8, step: 1 },
  memoryMiB: { min: 1024, max: 49152, step: 512 },
  diskGiB: { min: 10, max: 80, step: 1, growOnly: true },
}

export const TEST_ALLOWANCE: BotEnvironmentAllowance = { status: "ready", capacity: TEST_CAPACITY }
