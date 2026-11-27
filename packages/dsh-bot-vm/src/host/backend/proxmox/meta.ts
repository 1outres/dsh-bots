export interface BotMeta {
  readonly kind: "bot"
  readonly owner: string
  readonly botId: string
  readonly orphanedSince?: string
}

export interface VolumeMeta {
  readonly botId: string
  readonly orphanedSince?: string
}

export interface VolumesMeta {
  readonly kind: "volumes"
  readonly owner: string
  readonly volumes: Readonly<Record<string, VolumeMeta>>
}

export interface ImageMeta {
  readonly kind: "image"
  readonly owner: string
  readonly fingerprint: string
  readonly aliases: readonly string[]
}

export type VmMeta = BotMeta | VolumesMeta | ImageMeta

const MARK = "dsh-bots-meta: "
const VERSION = 1

type Fields = Readonly<Record<string, unknown>>

const recordOf = (value: unknown): Fields | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined
const text = (value: unknown): value is string => typeof value === "string" && value !== ""
const since = (value: unknown) => (text(value) ? { orphanedSince: value } : {})

function volumesOf(value: unknown): Readonly<Record<string, VolumeMeta>> | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const volumes: Record<string, VolumeMeta> = {}
  for (const [name, entry] of Object.entries(record)) {
    const fields = recordOf(entry)
    if (fields === undefined || !text(fields.botId)) return undefined
    volumes[name] = { botId: fields.botId, ...since(fields.orphanedSince) }
  }
  return volumes
}

function metaOfRecord(record: Fields): VmMeta | undefined {
  if (record.v !== VERSION || !text(record.owner)) return undefined
  switch (record.kind) {
    case "bot":
      return text(record.botId)
        ? { kind: "bot", owner: record.owner, botId: record.botId, ...since(record.orphanedSince) }
        : undefined
    case "volumes": {
      const volumes = volumesOf(record.volumes)
      return volumes === undefined ? undefined : { kind: "volumes", owner: record.owner, volumes }
    }
    case "image": {
      const aliases = record.aliases
      if (!text(record.fingerprint) || !Array.isArray(aliases) || !aliases.every(text))
        return undefined
      return { kind: "image", owner: record.owner, fingerprint: record.fingerprint, aliases }
    }
    default:
      return undefined
  }
}

export function metaOf(description: string | undefined): VmMeta | undefined {
  const line = description
    ?.split("\n")
    .filter((entry) => entry.startsWith(MARK))
    .pop()
  if (line === undefined) return undefined
  try {
    const record = recordOf(JSON.parse(line.slice(MARK.length)))
    return record === undefined ? undefined : metaOfRecord(record)
  } catch {
    return undefined
  }
}

export function descriptionOf(title: string, meta: VmMeta): string {
  return `${title}\n\n${MARK}${JSON.stringify({ v: VERSION, ...meta })}\n`
}
