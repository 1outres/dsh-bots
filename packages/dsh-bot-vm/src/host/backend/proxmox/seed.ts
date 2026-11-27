const SECTOR = 2048
const ROOT_SECTOR = 20
const VOLUME_ID = "cidata"

export interface SeedInput {
  readonly instance: string
  readonly vmid: number
  readonly mac: string
  readonly nameservers: readonly string[]
  readonly userData: string
}

const encoder = new TextEncoder()

function both16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
  view.setUint16(offset + 2, value, false)
}

function both32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
  view.setUint32(offset + 4, value, false)
}

function ascii(bytes: Uint8Array, offset: number, text: string) {
  bytes.set(encoder.encode(text), offset)
}

function recordDate(bytes: Uint8Array, offset: number, date: Date) {
  bytes.set(
    [
      date.getUTCFullYear() - 1900,
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      0,
    ],
    offset,
  )
}

function volumeDate(bytes: Uint8Array, offset: number, date: Date) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0")
  ascii(
    bytes,
    offset,
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}00`,
  )
  bytes[offset + 16] = 0
}

function directoryRecord(
  id: Uint8Array,
  extent: number,
  size: number,
  directory: boolean,
  date: Date,
): Uint8Array {
  const length = 33 + id.length + (id.length % 2 === 0 ? 1 : 0)
  const record = new Uint8Array(length)
  const view = new DataView(record.buffer)
  record[0] = length
  both32(view, 2, extent)
  both32(view, 10, size)
  recordDate(record, 18, date)
  record[25] = directory ? 2 : 0
  both16(view, 28, 1)
  record[32] = id.length
  record.set(id, 33)
  return record
}

export function isoOf(files: Readonly<Record<string, string>>, date: Date): Uint8Array {
  const entries = Object.entries(files)
    .map(([name, content]) => ({
      id: encoder.encode(`${name.toUpperCase()};1`),
      name: `${name.toUpperCase()};1`,
      data: encoder.encode(content),
      extent: 0,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  let next = ROOT_SECTOR + 1
  for (const entry of entries) {
    entry.extent = next
    next += Math.max(1, Math.ceil(entry.data.length / SECTOR))
  }
  const image = new Uint8Array(next * SECTOR)
  const view = new DataView(image.buffer)
  const pvd = 16 * SECTOR
  image[pvd] = 1
  ascii(image, pvd + 1, "CD001")
  image[pvd + 6] = 1
  image.fill(0x20, pvd + 8, pvd + 72)
  ascii(image, pvd + 40, VOLUME_ID)
  both32(view, pvd + 80, next)
  both16(view, pvd + 120, 1)
  both16(view, pvd + 124, 1)
  both16(view, pvd + 128, SECTOR)
  both32(view, pvd + 132, 10)
  view.setUint32(pvd + 140, 18, true)
  view.setUint32(pvd + 148, 19, false)
  image.set(directoryRecord(new Uint8Array([0]), ROOT_SECTOR, SECTOR, true, date), pvd + 156)
  image.fill(0x20, pvd + 190, pvd + 813)
  for (const offset of [813, 830, 864]) volumeDate(image, pvd + offset, date)
  image.fill(0x30, pvd + 847, pvd + 863)
  image[pvd + 881] = 1
  const terminator = 17 * SECTOR
  image[terminator] = 255
  ascii(image, terminator + 1, "CD001")
  image[terminator + 6] = 1
  for (const [sector, little] of [
    [18, true],
    [19, false],
  ] as const) {
    const at = sector * SECTOR
    image[at] = 1
    view.setUint32(at + 2, ROOT_SECTOR, little)
    view.setUint16(at + 6, 1, little)
  }
  let offset = ROOT_SECTOR * SECTOR
  for (const record of [
    directoryRecord(new Uint8Array([0]), ROOT_SECTOR, SECTOR, true, date),
    directoryRecord(new Uint8Array([1]), ROOT_SECTOR, SECTOR, true, date),
    ...entries.map((entry) =>
      directoryRecord(entry.id, entry.extent, entry.data.length, false, date),
    ),
  ]) {
    image.set(record, offset)
    offset += record.length
  }
  for (const entry of entries) image.set(entry.data, entry.extent * SECTOR)
  return image
}

export function networkConfig(mac: string, nameservers: readonly string[]): string {
  const document = {
    version: 2,
    ethernets: {
      nic0: {
        match: { macaddress: mac.toLowerCase() },
        dhcp4: true,
        nameservers: { addresses: [...nameservers] },
      },
    },
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

const metaData = (input: Pick<SeedInput, "instance" | "vmid">) =>
  `instance-id: ${input.instance}-${input.vmid}\nlocal-hostname: ${input.instance}\n`

export function seedOf(input: SeedInput, date: Date): Uint8Array {
  return isoOf(
    {
      "meta-data": metaData(input),
      "user-data": input.userData,
      "network-config": networkConfig(input.mac, input.nameservers),
    },
    date,
  )
}

export function emptySeedOf(input: Omit<SeedInput, "userData">, date: Date): Uint8Array {
  return isoOf(
    {
      "meta-data": metaData(input),
      "user-data": "#cloud-config\n{}\n",
      "network-config": networkConfig(input.mac, input.nameservers),
    },
    date,
  )
}
