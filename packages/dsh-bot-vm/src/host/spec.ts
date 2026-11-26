import type { BotEnvironmentSpec } from "@1outres/dsh-bot-core"
import type { IncusInstance, IncusVolume } from "./incus"

export const CPU_KEY = "limits.cpu"
export const MEMORY_KEY = "limits.memory"
export const SIZE_KEY = "size"

export const INCUS_VM_DEFAULT_CPUS = 1
export const INCUS_VM_DEFAULT_MEMORY = "1GiB"

export const MIB = 1024 ** 2
export const GIB = 1024 ** 3

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

export function specConfigOf(spec: BotEnvironmentSpec): Readonly<Record<string, string>> {
  return { [CPU_KEY]: String(spec.cpus), [MEMORY_KEY]: `${spec.memoryMiB}MiB` }
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

export function specOf(instance: IncusInstance, volume: IncusVolume): BotEnvironmentSpec {
  const sizes = instanceSizesOf(instance)
  const whole = (value: number | undefined, unit: number, what: string) => {
    if (value === undefined || !Number.isSafeInteger(value / unit) || value / unit < 1) {
      throw new Error(`cannot read the ${what} of Incus instance "${instance.name}"`)
    }
    return value / unit
  }
  return {
    cpus: whole(sizes.cpus, 1, `CPU count (${CPU_KEY})`),
    memoryMiB: whole(sizes.memoryBytes, MIB, `memory in MiB (${MEMORY_KEY})`),
    diskGiB: whole(sizeBytesOf(volume.config[SIZE_KEY]), GIB, "workspace volume size in GiB"),
  }
}
