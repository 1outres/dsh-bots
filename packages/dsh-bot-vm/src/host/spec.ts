/**
 * A bot's spec as Incus config: the instance's own `limits.cpu`,
 * `limits.memory` and root disk `size`, and what an instance runs with
 * now (its expanded config and devices, profiles included).
 */
import type { BotEnvironmentSpec } from "@1outres/dsh-bot-core"
import type { IncusDevice, IncusInstance } from "./incus"

export const CPU_KEY = "limits.cpu"
export const MEMORY_KEY = "limits.memory"
export const ROOT_DEVICE = "root"

/** What Incus gives a VM whose config and profiles set no `limits.cpu` / `limits.memory`. */
export const INCUS_VM_DEFAULT_CPUS = 1
export const INCUS_VM_DEFAULT_MEMORY = "1GiB"

const MIB = 1024 ** 2
const GIB = 1024 ** 3

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

/** An Incus size in bytes, or undefined for one this cannot read (a percentage). */
export function sizeBytesOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/.exec(value.trim())
  if (match === null) return undefined
  const unit = UNITS[match[2] === "" ? "B" : (match[2] as string)]
  return unit === undefined ? undefined : Number(match[1]) * unit
}

/** The instance's own config the spec sets. */
export function specConfigOf(spec: BotEnvironmentSpec): Readonly<Record<string, string>> {
  return { [CPU_KEY]: String(spec.cpus), [MEMORY_KEY]: `${spec.memoryMiB}MiB` }
}

/** The instance's own root disk: the one it runs with (its pool, from the profiles), at the spec's size. */
export function rootDeviceOf(instance: IncusInstance, spec: BotEnvironmentSpec): IncusDevice {
  const root = instance.expanded_devices?.[ROOT_DEVICE]
  if (root === undefined || root.type !== "disk" || root.path !== "/") {
    throw new Error(`Incus instance "${instance.name}" has no root disk device`)
  }
  return { ...root, size: `${spec.diskGiB}GiB` }
}

/** What the instance runs with now, each value in bytes or a count; undefined where Incus's value cannot be read. */
export interface InstanceSizes {
  readonly cpus: number | undefined
  readonly memoryBytes: number | undefined
  readonly diskBytes: number | undefined
}

export function instanceSizesOf(instance: IncusInstance): InstanceSizes {
  const config = instance.expanded_config ?? instance.config
  const cpu = config[CPU_KEY]
  return {
    cpus: cpu === undefined ? INCUS_VM_DEFAULT_CPUS : /^\d+$/.test(cpu) ? Number(cpu) : undefined,
    memoryBytes: sizeBytesOf(config[MEMORY_KEY] ?? INCUS_VM_DEFAULT_MEMORY),
    diskBytes: sizeBytesOf(instance.expanded_devices?.[ROOT_DEVICE]?.size),
  }
}

/** Whether the instance runs with exactly the spec. */
export function runsWith(sizes: InstanceSizes, spec: BotEnvironmentSpec): boolean {
  return (
    sizes.cpus === spec.cpus &&
    sizes.memoryBytes === spec.memoryMiB * MIB &&
    sizes.diskBytes === spec.diskGiB * GIB
  )
}

/** The spec of what the instance runs with. @throws when a value is not a whole number of the spec's units. */
export function specOfInstance(instance: IncusInstance): BotEnvironmentSpec {
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
    diskGiB: whole(sizes.diskBytes, GIB, "root disk size in GiB"),
  }
}

export const bytesOfDisk = (spec: BotEnvironmentSpec) => spec.diskGiB * GIB
