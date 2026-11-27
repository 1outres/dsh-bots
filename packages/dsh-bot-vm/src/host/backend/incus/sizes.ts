import type { InstanceResources } from "../contract"
import type { IncusInstance } from "./client"

export const CPU_KEY = "limits.cpu"
export const MEMORY_KEY = "limits.memory"
export const SIZE_KEY = "size"

export const INCUS_VM_DEFAULT_CPUS = 1
export const INCUS_VM_DEFAULT_MEMORY = "1GiB"

export const MIB = 1024 ** 2
export const GIB = 1024 ** 3

export const INCUS_VM_DEFAULT_STATE_BYTES = 500 * MIB

const UNITS: Readonly<Record<string, number>> = {
  B: 1,
  kB: 1000,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KiB: 1024,
  MiB: MIB,
  GiB: GIB,
  TiB: 1024 ** 4,
}

export function sizeBytesOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/.exec(value.trim())
  if (match === null) return undefined
  const unit = UNITS[match[2] === "" ? "B" : (match[2] as string)]
  return unit === undefined ? undefined : Number(match[1]) * unit
}

export function resourceConfigOf(
  resources: Pick<InstanceResources, "cpus" | "memoryMiB">,
): Readonly<Record<string, string>> {
  return { [CPU_KEY]: String(resources.cpus), [MEMORY_KEY]: `${resources.memoryMiB}MiB` }
}

export const gibText = (gib: number) => `${gib}GiB`

export interface InstanceSizes {
  readonly cpus: number | undefined
  readonly memoryBytes: number | undefined
}

export function instanceSizesOf(instance: IncusInstance): InstanceSizes {
  const config = instance.expanded_config ?? instance.config
  const cpu = config[CPU_KEY]
  return {
    cpus: cpu === undefined ? INCUS_VM_DEFAULT_CPUS : /^\d+$/.test(cpu) ? Number(cpu) : undefined,
    memoryBytes: sizeBytesOf(config[MEMORY_KEY] ?? INCUS_VM_DEFAULT_MEMORY),
  }
}
