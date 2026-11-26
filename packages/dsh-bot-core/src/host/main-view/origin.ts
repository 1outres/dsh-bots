import type { MainMessageAuthor, MainTimelineFile } from "../../shared/main-view"

const HEADER = /^\[([^[\]]*) · ([^[\]]*) · ([^[\]()]*) \(([^()[\]]*)\)\]$/u

const SAVED = "Attached files, saved in your workspace:"
const SAVED_FILE = /^- (.+) \(([^()]+)\)$/u

export interface PersonText {
  readonly author: MainMessageAuthor
  readonly text: string
  readonly saved: readonly MainTimelineFile[]
}

const WEB: MainMessageAuthor = { kind: "web" }

function authorOf(line: string): MainMessageAuthor | undefined {
  const match = HEADER.exec(line)
  if (match === null) return undefined
  const [, channel = "", place = "", name = "", marks = ""] = match
  const parts = marks.split(", ")
  const handle = parts.find((part) => part.startsWith("@"))
  if (handle === undefined) return undefined
  return {
    kind: "channel",
    channel,
    place,
    name,
    handle: handle.slice(1),
    owner: parts.includes("owner"),
    bot: parts.includes("bot"),
  }
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

function savedFiles(body: string): { readonly text: string; readonly saved: MainTimelineFile[] } {
  const at = body.lastIndexOf(SAVED)
  if (at === -1 || (at > 0 && body.slice(at - 2, at) !== "\n\n")) return { text: body, saved: [] }
  const lines = body.slice(at + SAVED.length + 1).split("\n")
  const saved: MainTimelineFile[] = []
  for (const line of lines) {
    const file = SAVED_FILE.exec(line)
    if (file === null) return { text: body, saved: [] }
    const path = file[1] as string
    saved.push({ name: baseName(path), size: file[2] as string, path })
  }
  return { text: body.slice(0, Math.max(0, at - 2)), saved }
}

export function personTextOf(text: string): PersonText {
  const newline = text.indexOf("\n")
  const first = newline === -1 ? text : text.slice(0, newline)
  const author = authorOf(first)
  if (author === undefined) return { author: WEB, text: text.trim(), saved: [] }
  const body = savedFiles(newline === -1 ? "" : text.slice(newline + 1))
  return { author, text: body.text.trim(), saved: body.saved }
}
