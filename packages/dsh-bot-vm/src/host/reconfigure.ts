/**
 * How an existing instance comes to have its bot's layout (pure; the
 * environment carries it out). The instance's own config and devices are
 * compared with the layout:
 * - Anything that differs stops a running instance, is written while it is
 *   stopped, and the instance starts again: Incus does not give a running VM
 *   more memory than it booted with, a guest sees more CPUs or a larger disk
 *   only after a restart, and devices are never hot-plugged.
 * - CPU and memory written differently but meaning the same (`4GiB` for
 *   `4096MiB`) are written without a stop.
 * - A root disk smaller than the instance's is refused (Incus cannot shrink a
 *   VM's block volume).
 */
import type { IncusDevice, IncusInstance, InstanceUpdate } from "./incus"
import { type InstanceLayout, ROOT_DEVICE } from "./layout"
import { CPU_KEY, MEMORY_KEY, sizeBytesOf } from "./spec"

export interface Reconfiguration {
  /** A running (or frozen) instance stops before {@link change} is set. */
  readonly stop: boolean
  /** Made before the instance (re)starts; undefined when nothing changes. */
  readonly change: InstanceUpdate | undefined
}

export const sameDevice = (found: IncusDevice | undefined, wanted: IncusDevice) =>
  found !== undefined &&
  Object.keys(found).length === Object.keys(wanted).length &&
  Object.entries(wanted).every(([key, value]) => found[key] === value)

const SAME_MEANING: Readonly<Record<string, (value: string) => number | undefined>> = {
  [CPU_KEY]: (value) => (/^\d+$/.test(value) ? Number(value) : undefined),
  [MEMORY_KEY]: sizeBytesOf,
}

function meansTheSame(key: string, found: string | undefined, wanted: string): boolean {
  const read = SAME_MEANING[key]
  if (read === undefined || found === undefined) return false
  const value = read(found)
  return value !== undefined && value === read(wanted)
}

/** @throws when the layout's root disk is smaller than the instance's. */
export function reconfigure(instance: IncusInstance, layout: InstanceLayout): Reconfiguration {
  const root = layout.devices[ROOT_DEVICE]
  const currentRoot = sizeBytesOf(instance.devices[ROOT_DEVICE]?.size)
  const wantedRoot = sizeBytesOf(root?.size)
  if (currentRoot !== undefined && wantedRoot !== undefined && wantedRoot < currentRoot) {
    throw new Error(
      `the root disk of Incus instance "${instance.name}" is ${instance.devices[ROOT_DEVICE]?.size}; it cannot shrink to ${root?.size}`,
    )
  }
  const config = Object.fromEntries(
    Object.entries(layout.config).filter(([key, value]) => instance.config[key] !== value),
  )
  const devices = Object.fromEntries(
    Object.entries(layout.devices).filter(
      ([name, device]) => !sameDevice(instance.devices[name], device),
    ),
  )
  const restarts =
    Object.keys(devices).length > 0 ||
    Object.entries(config).some(([key, value]) => !meansTheSame(key, instance.config[key], value))
  const change: InstanceUpdate = {
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(Object.keys(devices).length > 0 ? { devices } : {}),
  }
  return {
    stop: instance.status !== "Stopped" && restarts,
    change: Object.keys(change).length > 0 ? change : undefined,
  }
}
