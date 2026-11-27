import type { ProxmoxPoolLimits } from "@1outres/dsh-bot-core"

const DECLARATION = /(?:^|\s)dsh-bots: cpus=(\d+) memory=(\d+)GiB(?:\s|$)/

export const limitsLine = (limits: ProxmoxPoolLimits) =>
  `dsh-bots: cpus=${limits.cpus} memory=${limits.memoryMiB / 1024}GiB`

export function poolLimitsOf(comment: string): ProxmoxPoolLimits | undefined {
  const match = DECLARATION.exec(comment)
  if (match === null) return undefined
  const cpus = Number(match[1])
  const memoryGiB = Number(match[2])
  if (cpus < 1 || memoryGiB < 1) return undefined
  return { cpus, memoryMiB: memoryGiB * 1024 }
}
