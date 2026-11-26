/**
 * manifest.txt of a base image release (infra/vm/export-image.sh):
 *   format 1
 *   dsh <DSH version>
 *   image <file name> <bytes> <sha256 = Incus fingerprint>
 *   part <file name> <bytes> <sha256>        (in order, at least one)
 */
import type { BotEnvironmentImageFile } from "@1outres/dsh-bot-core"

export interface ImagePart {
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

export interface ImageManifest {
  readonly dsh: string
  readonly image: BotEnvironmentImageFile
  readonly parts: readonly ImagePart[]
}

export type ManifestReading =
  | { readonly ok: true; readonly manifest: ImageManifest }
  | { readonly ok: false; readonly reason: string }

export const MANIFEST_FILE = "manifest.txt"
const SUPPORTED_FORMAT = "1"
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const BYTES = /^[1-9][0-9]*$/
const SHA256 = /^[0-9a-f]{64}$/

function fileOf(fields: readonly string[], record: string): ImagePart | string {
  if (fields.length !== 3) return `"${record}" needs a name, a size and a sha256`
  const [name, bytes, sha256] = fields as [string, string, string]
  if (!NAME.test(name) || name === MANIFEST_FILE) return `"${name}" is not a file name`
  if (!BYTES.test(bytes) || !Number.isSafeInteger(Number(bytes))) return `"${bytes}" is not a size`
  if (!SHA256.test(sha256)) return `"${sha256}" is not a sha256`
  return { name, bytes: Number(bytes), sha256 }
}

export function parseManifest(text: string): ManifestReading {
  const fail = (reason: string): ManifestReading => ({ ok: false, reason })
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
  let format: string | undefined
  let dsh: string | undefined
  let image: ImagePart | undefined
  const parts: ImagePart[] = []
  for (const [index, line] of lines.entries()) {
    const [record, ...fields] = line.split(" ")
    const at = `line ${index + 1}`
    switch (record) {
      case "format":
      case "dsh": {
        if (fields.length !== 1 || fields[0] === "")
          return fail(`${at}: "${record}" needs one value`)
        if ((record === "format" ? format : dsh) !== undefined)
          return fail(`${at}: "${record}" appears twice`)
        if (record === "format") format = fields[0]
        else dsh = fields[0]
        break
      }
      case "image":
      case "part": {
        const file = fileOf(fields, record)
        if (typeof file === "string") return fail(`${at}: ${file}`)
        if (record === "image") {
          if (image !== undefined) return fail(`${at}: "image" appears twice`)
          image = file
        } else {
          if (parts.some((part) => part.name === file.name))
            return fail(`${at}: the part ${file.name} appears twice`)
          parts.push(file)
        }
        break
      }
      default:
        return fail(`${at}: unknown record "${record}"`)
    }
  }
  if (format !== SUPPORTED_FORMAT) {
    return fail(`it has format ${format ?? "(none)"}, this plugin reads format ${SUPPORTED_FORMAT}`)
  }
  if (dsh === undefined) return fail("it names no DSH version")
  if (image === undefined) return fail("it names no image")
  if (parts.length === 0) return fail("it lists no parts")
  const sum = parts.reduce((total, part) => total + part.bytes, 0)
  if (sum !== image.bytes) return fail(`its parts have ${sum} bytes, the image ${image.bytes}`)
  if (parts.some((part) => part.name === image.name))
    return fail(`a part has the image's name ${image.name}`)
  return {
    ok: true,
    manifest: {
      dsh,
      image: { name: image.name, bytes: image.bytes, fingerprint: image.sha256 },
      parts,
    },
  }
}
