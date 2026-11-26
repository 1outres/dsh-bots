import type { InstanceShape } from "../contract"
import type { IncusDeclaration } from "./check"
import type { IncusDevice } from "./client"
import { gibText, resourceConfigOf } from "./sizes"

export const ROOT_DEVICE = "root"
export const NIC_DEVICE = "eth0"
export const WORKSPACE_DEVICE = "workspace"
export const WORKSPACE_BY_ID = `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_${WORKSPACE_DEVICE}`

export interface InstanceLayout {
  readonly config: Readonly<Record<string, string>>
  readonly devices: Readonly<Record<string, IncusDevice>>
}

export function layoutOf(
  shape: InstanceShape,
  declaration: Pick<IncusDeclaration, "pool" | "network">,
): InstanceLayout {
  const { pool, network } = declaration
  return {
    config: {
      ...resourceConfigOf(shape.resources),
      "security.guestapi": "false",
      "security.secureboot": "false",
      "boot.autostart": "true",
    },
    devices: {
      [ROOT_DEVICE]: { type: "disk", path: "/", pool, size: gibText(shape.resources.rootDiskGiB) },
      [NIC_DEVICE]: {
        type: "nic",
        name: NIC_DEVICE,
        network,
        "security.port_isolation": "true",
        "security.mac_filtering": "true",
        "security.ipv4_filtering": "true",
      },
      [WORKSPACE_DEVICE]: { type: "disk", pool, source: shape.workspace },
    },
  }
}
