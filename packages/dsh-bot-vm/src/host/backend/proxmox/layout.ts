import type { ProxmoxParams } from "./client"

export const ROOT_DISK = "scsi0"
export const WORKSPACE_DISK = "virtio1"
export const SEED_DRIVE = "ide3"
export const NIC = "net0"
export const WORKSPACE_SERIAL = "dsh-workspace"
export const WORKSPACE_BY_ID = `/dev/disk/by-id/virtio-${WORKSPACE_SERIAL}`
export const IPFILTER_SET = `ipfilter-${NIC}`
export const SSH_PORT = 22
export const REQUIRED_CONTENT = ["images", "import", "iso"] as const

const GIB = 1024 ** 3
const SIZE = /(?:^|,)size=(\d+(?:\.\d+)?)([KMGT]?)(?:,|$)/
const MAC = /(?:^|,)virtio=([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:,|$)/
const DISK_KEY = /^(?:scsi|virtio|sata|ide|efidisk|tpmstate)\d+$/
const UNIT: Readonly<Record<string, number>> = {
  "": 1,
  K: 1024,
  M: 1024 ** 2,
  G: GIB,
  T: 1024 ** 4,
}

export const workspaceFile = (holder: number, name: string) => `vm-${holder}-${name}.raw`
export const workspaceVolid = (storage: string, holder: number, name: string) =>
  `${storage}:${holder}/${workspaceFile(holder, name)}`
export const seedFile = (instance: string) => `dsh-bots-seed-${instance}.iso`
export const seedVolid = (storage: string, instance: string) =>
  `${storage}:iso/${seedFile(instance)}`
export const importFile = (fingerprint: string) => `dsh-bots-${fingerprint}.qcow2`
export const importVolid = (storage: string, fingerprint: string) =>
  `${storage}:import/${importFile(fingerprint)}`

export function workspaceNameOf(holder: number, volid: string): string | undefined {
  const file = volid.slice(volid.indexOf("/") + 1)
  const prefix = `vm-${holder}-`
  return file.startsWith(prefix) && file.endsWith(".raw")
    ? file.slice(prefix.length, -4)
    : undefined
}

export const volidOfDisk = (value: string) => value.split(",")[0] as string

export function diskEntries(config: Readonly<Record<string, string>>): readonly [string, string][] {
  return Object.entries(config).filter(
    ([key, value]) => DISK_KEY.test(key) && !value.includes("media=cdrom"),
  )
}

export function sizeBytesOfDisk(value: string | undefined): number | undefined {
  const match = value === undefined ? null : SIZE.exec(value)
  if (match === null) return undefined
  return Math.round(Number(match[1]) * (UNIT[match[2] as string] as number))
}

export function macOf(value: string | undefined): string | undefined {
  const match = value === undefined ? null : MAC.exec(value)
  return match === null ? undefined : (match[1] as string).toLowerCase()
}

const BASE = /:(\d+)\/base-\1-/

export function baseTemplateOf(config: Readonly<Record<string, string>>): number | undefined {
  const match = BASE.exec(config[ROOT_DISK] ?? "")
  return match === null ? undefined : Number(match[1])
}

export const nicValue = (mac: string, bridge: string) =>
  `virtio=${mac.toUpperCase()},bridge=${bridge},firewall=1`

export const workspaceValue = (volid: string) =>
  `${volid},serial=${WORKSPACE_SERIAL},discard=on,iothread=1`

export const seedValue = (volid: string) => `${volid},media=cdrom`

export const gibText = (gib: number) => `${gib}G`

export interface TemplateRequest {
  readonly vmid: number
  readonly name: string
  readonly pool: string
  readonly storage: string
  readonly bridge: string
  readonly description: string
  readonly importVolid: string
}

export function templateParams(request: TemplateRequest): ProxmoxParams {
  return {
    vmid: request.vmid,
    name: request.name,
    pool: request.pool,
    description: request.description,
    ostype: "l26",
    machine: "q35",
    bios: "ovmf",
    efidisk0: `${request.storage}:1,efitype=4m,pre-enrolled-keys=0`,
    scsihw: "virtio-scsi-single",
    [ROOT_DISK]: `${request.storage}:0,import-from=${request.importVolid},discard=on,iothread=1`,
    serial0: "socket",
    boot: `order=${ROOT_DISK}`,
    cores: 1,
    memory: 1024,
    [NIC]: `virtio,bridge=${request.bridge},firewall=1`,
    agent: "enabled=1",
  }
}

export interface HolderRequest {
  readonly vmid: number
  readonly name: string
  readonly pool: string
  readonly description: string
}

export const holderParams = (request: HolderRequest): ProxmoxParams => ({
  vmid: request.vmid,
  name: request.name,
  pool: request.pool,
  description: request.description,
  ostype: "other",
  memory: 64,
  cores: 1,
  onboot: 0,
})

export const MAX_VIRTIO = 15
export const virtioSlots = () =>
  Array.from({ length: MAX_VIRTIO + 1 }, (_, index) => `virtio${index}`)
