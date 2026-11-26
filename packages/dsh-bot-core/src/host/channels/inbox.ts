export const INBOX_DIRECTORY = ".inbox"
export const MAX_FILE_NAME_BYTES = 120
const MAX_EXTENSION_LENGTH = 16
const FALLBACK_NAME = "file"

export interface InboxWriter {
  createFolder(root: string, base: string, signal: AbortSignal): Promise<string>
  writeFile(folder: string, name: string, data: Uint8Array, signal: AbortSignal): Promise<string>
}

const encoder = new TextEncoder()
const bytesOf = (text: string) => encoder.encode(text).byteLength

function cutToBytes(text: string, limit: number): string {
  let result = ""
  for (const character of text) {
    if (bytesOf(result + character) > limit) break
    result += character
  }
  return result
}

export function sanitizeFileName(name: string): string {
  const leaf = name.split(/[/\\]/u).at(-1) ?? ""
  const cleaned = leaf
    .normalize("NFC")
    .replace(/\p{Cc}|\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[.\-\s]+/u, "")
  if (cleaned.length === 0) return FALLBACK_NAME
  if (bytesOf(cleaned) <= MAX_FILE_NAME_BYTES) return cleaned
  const dot = cleaned.lastIndexOf(".")
  const extension =
    dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH ? cleaned.slice(dot) : ""
  const stem = cleaned.slice(0, cleaned.length - extension.length)
  return cutToBytes(stem, MAX_FILE_NAME_BYTES - bytesOf(extension)).trimEnd() + extension
}

export function distinctNames(names: readonly string[]): string[] {
  const taken = new Set<string>()
  return names.map((name) => {
    let candidate = name
    for (let index = 2; taken.has(candidate); index += 1) {
      const dot = name.lastIndexOf(".")
      const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
      candidate = `${stem} (${index})${extension}`
    }
    taken.add(candidate)
    return candidate
  })
}

const pad = (value: number) => String(value).padStart(2, "0")

export function inboxFolderName(sentAt: number, channelId: string): string {
  const date = new Date(sentAt)
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  return `${day}T${time}Z-${channelId}`
}
