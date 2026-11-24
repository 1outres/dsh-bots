/**
 * Where the files people attach are saved: `<workspace>/.inbox/<folder>/<name>`,
 * one new folder per message (named after when it was sent and through which
 * channel), names made safe and distinct inside it.
 */

/** The inbox directory, inside the bot's workspace. */
export const INBOX_DIRECTORY = ".inbox"
/** Longest file name kept, in UTF-8 bytes (Linux allows 255). */
export const MAX_FILE_NAME_BYTES = 120
const MAX_EXTENSION_LENGTH = 16
const FALLBACK_NAME = "file"

/** Writes into the bot's environment, never the Host's file system. */
export interface InboxWriter {
  /** Create a new folder `root/base` (or `base-2`, `base-3`… when taken), parents included; its path. */
  createFolder(root: string, base: string, signal: AbortSignal): Promise<string>
  /** Write a new file `folder/name` (refused when it exists); its path. */
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

/**
 * A name that is one plain path segment: no directory part, no control
 * characters, no leading dot or dash, at most {@link MAX_FILE_NAME_BYTES}
 * bytes (the extension kept).
 */
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

/** `name`, or `name (2).ext`, `name (3).ext`… so that no two are equal. */
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

/** The folder of one message: `20261123T044509Z-discord` (UTC). */
export function inboxFolderName(sentAt: number, channelId: string): string {
  const date = new Date(sentAt)
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  return `${day}T${time}Z-${channelId}`
}
