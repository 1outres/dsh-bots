/**
 * How an existing instance comes to have what its bot needs (pure; the
 * environment carries it out). The bot's ensure target is the goal; the
 * instance's own config is what is applied:
 * - A share or a spec that differs from what the instance runs with stops a
 *   running instance, is written while it is stopped, and the instance
 *   starts again. Incus refuses to change `raw.idmap` of a running VM, and
 *   does not give a running VM more memory than it booted with; more CPUs
 *   or a larger disk written live are not seen by the guest until it restarts
 *   (measured on Incus 6.0).
 * - Own config that differs only in how it is written (the profiles give the
 *   same values, or `4GiB` for `4096MiB`) is written without a stop: Incus
 *   changes nothing in the running VM then.
 * - A root disk smaller than the instance's is refused: Incus cannot shrink
 *   a VM's block volume.
 */
import type { BotEnvironmentSpec } from "@1outres/dsh-bot-core"
import type { IncusDevice, IncusInstance, InstanceUpdate } from "./incus"
import {
  bytesOfDisk,
  instanceSizesOf,
  ROOT_DEVICE,
  rootDeviceOf,
  runsWith,
  specConfigOf,
} from "./spec"

/** What the bot needs of its instance. */
export interface InstanceWants {
  /** Config keys the share needs (`raw.idmap`). */
  readonly shareConfig: Readonly<Record<string, string>>
  /** The share's device. */
  readonly shareDevice: { readonly name: string; readonly device: IncusDevice }
  readonly spec: BotEnvironmentSpec
}

export interface Reconfiguration {
  /** A running (or frozen) instance stops before {@link change} is set. */
  readonly stop: boolean
  /** Made before the instance (re)starts; undefined when nothing changes. */
  readonly change: InstanceUpdate | undefined
  /** Whether the change gives the instance another spec (not only another way of writing it). */
  readonly resizes: boolean
}

export const sameDevice = (found: IncusDevice | undefined, wanted: IncusDevice) =>
  found !== undefined &&
  Object.keys(found).length === Object.keys(wanted).length &&
  Object.entries(wanted).every(([key, value]) => found[key] === value)

/** @throws when the spec's disk is smaller than the instance's. */
export function reconfigure(instance: IncusInstance, wants: InstanceWants): Reconfiguration {
  const stopped = instance.status === "Stopped"
  const shared =
    sameDevice(instance.devices[wants.shareDevice.name], wants.shareDevice.device) &&
    Object.entries(wants.shareConfig).every(([key, value]) => instance.config[key] === value)
  const sizes = instanceSizesOf(instance)
  if (sizes.diskBytes !== undefined && bytesOfDisk(wants.spec) < sizes.diskBytes) {
    throw new Error(
      `the root disk of Incus instance "${instance.name}" is ${instance.expanded_devices?.[ROOT_DEVICE]?.size}; it cannot shrink to ${wants.spec.diskGiB}GiB`,
    )
  }
  const resizes = !runsWith(sizes, wants.spec)
  const specConfig = Object.fromEntries(
    Object.entries(specConfigOf(wants.spec)).filter(
      ([key, value]) => instance.config[key] !== value,
    ),
  )
  const root = rootDeviceOf(instance, wants.spec)
  const rootDiffers = !sameDevice(instance.devices[ROOT_DEVICE], root)
  const config = { ...(shared ? {} : wants.shareConfig), ...specConfig }
  const devices = {
    ...(shared ? {} : { [wants.shareDevice.name]: wants.shareDevice.device }),
    ...(rootDiffers ? { [ROOT_DEVICE]: root } : {}),
  }
  const change: InstanceUpdate = {
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(Object.keys(devices).length > 0 ? { devices } : {}),
  }
  return {
    stop: !stopped && (!shared || resizes),
    change: Object.keys(change).length > 0 ? change : undefined,
    resizes,
  }
}
