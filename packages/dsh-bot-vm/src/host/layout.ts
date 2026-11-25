/**
 * What a bot's instance is made of, written into the instance itself (no
 * profiles, docs/specs/incus-endpoint.md §3.4, §10.8): its own config, a root
 * disk and a NIC on the pool and network the project declares, and the
 * workspace volume attached as a block device.
 */
import type { BotEnvironmentSpec } from "@1outres/dsh-bot-core"
import type { ProjectDeclaration } from "./endpoint-check"
import type { IncusDevice } from "./incus"
import { gibText, specConfigOf } from "./spec"

export const ROOT_DEVICE = "root"
export const NIC_DEVICE = "eth0"
/** The guest sees it as /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_<device>. */
export const WORKSPACE_DEVICE = "workspace"
export const WORKSPACE_BY_ID = `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_${WORKSPACE_DEVICE}`

export interface InstanceLayout {
  readonly config: Readonly<Record<string, string>>
  readonly devices: Readonly<Record<string, IncusDevice>>
}

export interface LayoutInput {
  readonly spec: BotEnvironmentSpec
  readonly placement: Pick<ProjectDeclaration, "pool" | "network">
  readonly volume: string
  readonly rootDiskGiB: number
}

export function layoutOf(input: LayoutInput): InstanceLayout {
  const { pool, network } = input.placement
  return {
    config: {
      ...specConfigOf(input.spec),
      // The user-data carries the host's private key: keep the guest API
      // (which serves cloud-init.* and user.* keys) away from the guest.
      "security.guestapi": "false",
      "security.secureboot": "false",
      "boot.autostart": "true",
    },
    devices: {
      [ROOT_DEVICE]: { type: "disk", path: "/", pool, size: gibText(input.rootDiskGiB) },
      [NIC_DEVICE]: {
        type: "nic",
        name: NIC_DEVICE,
        network,
        "security.port_isolation": "true",
        "security.mac_filtering": "true",
        "security.ipv4_filtering": "true",
      },
      [WORKSPACE_DEVICE]: { type: "disk", pool, source: input.volume },
    },
  }
}
