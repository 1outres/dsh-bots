/**
 * One note file (docs/specs/bot-notes.md §2): `notes/<UUID>.md`, a YAML
 * frontmatter of the fields below, then the body as the current state of the
 * thing. Only the subset of YAML a note needs is read and written: plain or
 * quoted scalars, `true` / `false`, and a list as `[a, b]` or as `- a` lines.
 */

import { NOTE_TYPES, type NoteType } from "../../shared/notes"

export { NOTE_TYPES, type NoteType }

export interface NoteFields {
  readonly title: string
  readonly type: NoteType
  readonly aliases: readonly string[]
  /** One line; absent only on daily notes. */
  readonly summary?: string
  readonly pinned: boolean
}

/** A note as stored: its body's links name notes by id. */
export interface Note extends NoteFields {
  readonly body: string
}

export const NOTES_DIRECTORY = "notes"

const NOTE_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/

/** The note id a file name of the notes directory carries, or undefined for any other file. */
export function noteIdOf(fileName: string): string | undefined {
  return NOTE_FILE.exec(fileName)?.[1]
}

export const noteFileName = (id: string) => `${id}.md`

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string }

const KEYS = ["title", "type", "aliases", "summary", "pinned"] as const
type Key = (typeof KEYS)[number]

const isKey = (key: string): key is Key => (KEYS as readonly string[]).includes(key)

/** Why a title or alias cannot be one: it must fit a link. */
export function nameProblem(name: string): string | undefined {
  if (name.trim() === "") return "is empty"
  if (name !== name.trim()) return "starts or ends with a space"
  if (/[\r\n]/u.test(name)) return "has a line break"
  if (name.includes("[[") || name.includes("]]") || name.includes("|"))
    return 'contains "[[", "]]" or "|"'
  return undefined
}

function scalarOf(raw: string): Parsed<string> {
  const text = raw.trim()
  if (text.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === "string"
        ? { ok: true, value }
        : { ok: false, problem: `${text} is not a string` }
    } catch {
      return { ok: false, problem: `${text} is not a valid quoted string` }
    }
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'"))
      return { ok: false, problem: `${text} is not a valid quoted string` }
    const inner = text.slice(1, -1)
    if (/(^|[^'])'([^']|$)/u.test(inner.replaceAll("''", ""))) {
      return { ok: false, problem: `${text} is not a valid quoted string` }
    }
    return { ok: true, value: inner.replaceAll("''", "'") }
  }
  return { ok: true, value: text.replace(/\s+#.*$/u, "") }
}

function splitFlow(inner: string): Parsed<readonly string[]> {
  const items: string[] = []
  let current = ""
  let quote: string | undefined
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index] as string
    if (quote !== undefined) {
      current += char
      if (char === "\\" && quote === '"') {
        current += inner[index + 1] ?? ""
        index += 1
      } else if (char === quote) {
        if (quote === "'" && inner[index + 1] === "'") {
          current += "'"
          index += 1
        } else quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") quote = char
    if (char === ",") {
      items.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (quote !== undefined) return { ok: false, problem: "an alias has an unclosed quote" }
  if (current.trim() !== "" || items.length > 0) items.push(current)
  const values: string[] = []
  for (const item of items) {
    const value = scalarOf(item)
    if (!value.ok) return value
    values.push(value.value)
  }
  return { ok: true, value: values }
}

function listOf(first: string, rest: readonly string[]): Parsed<readonly string[]> {
  const text = first.trim()
  if (text !== "") {
    if (rest.length > 0) return { ok: false, problem: "aliases has both a value and list lines" }
    if (!text.startsWith("[") || !text.endsWith("]")) {
      return { ok: false, problem: "aliases must be a list ([a, b] or - lines)" }
    }
    return splitFlow(text.slice(1, -1))
  }
  const values: string[] = []
  for (const line of rest) {
    const item = /^\s+-\s+(.*)$/u.exec(line)
    if (item === null) return { ok: false, problem: `aliases: "${line.trim()}" is not a list item` }
    const value = scalarOf(item[1] as string)
    if (!value.ok) return value
    values.push(value.value)
  }
  return { ok: true, value: values }
}

/** Split a file into its frontmatter lines and its body. */
function sections(
  text: string,
): Parsed<{ readonly head: readonly string[]; readonly body: string }> {
  const lines = text.replaceAll("\r\n", "\n").split("\n")
  if (lines[0] !== "---")
    return { ok: false, problem: 'the file does not start with a "---" frontmatter line' }
  const end = lines.indexOf("---", 1)
  if (end === -1) return { ok: false, problem: 'the frontmatter has no closing "---" line' }
  return {
    ok: true,
    value: {
      head: lines.slice(1, end),
      body: lines
        .slice(end + 1)
        .join("\n")
        .replace(/\n+$/u, ""),
    },
  }
}

/** Read a note file. */
export function parseNote(text: string): Parsed<Note> {
  const split = sections(text)
  if (!split.ok) return split
  const raw = new Map<Key, { first: string; rest: string[] }>()
  let open: { first: string; rest: string[] } | undefined
  for (const line of split.value.head) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue
    if (/^\s/u.test(line)) {
      if (open === undefined) return { ok: false, problem: `"${line.trim()}" belongs to no field` }
      open.rest.push(line)
      continue
    }
    const field = /^([A-Za-z_][\w-]*):(?:\s(.*)|)$/u.exec(line)
    if (field === null) return { ok: false, problem: `"${line}" is not a "key: value" line` }
    const key = field[1] as string
    if (!isKey(key))
      return { ok: false, problem: `unknown field "${key}" (fields: ${KEYS.join(", ")})` }
    if (raw.has(key)) return { ok: false, problem: `the field "${key}" appears twice` }
    open = { first: field[2] ?? "", rest: [] }
    raw.set(key, open)
  }
  const scalar = (key: Key): Parsed<string | undefined> => {
    const entry = raw.get(key)
    if (entry === undefined) return { ok: true, value: undefined }
    if (entry.rest.length > 0) return { ok: false, problem: `${key} must be one line` }
    const value = scalarOf(entry.first)
    return value.ok ? value : { ok: false, problem: `${key}: ${value.problem}` }
  }
  const title = scalar("title")
  if (!title.ok) return title
  if (title.value === undefined) return { ok: false, problem: "the title field is missing" }
  const titleProblem = nameProblem(title.value)
  if (titleProblem !== undefined) return { ok: false, problem: `the title ${titleProblem}` }
  const type = scalar("type")
  if (!type.ok) return type
  if (type.value === undefined) return { ok: false, problem: "the type field is missing" }
  if (!(NOTE_TYPES as readonly string[]).includes(type.value)) {
    return { ok: false, problem: `type "${type.value}" is not one of ${NOTE_TYPES.join(", ")}` }
  }
  const summary = scalar("summary")
  if (!summary.ok) return summary
  const pinned = scalar("pinned")
  if (!pinned.ok) return pinned
  if (pinned.value !== undefined && pinned.value !== "true" && pinned.value !== "false") {
    return { ok: false, problem: "pinned must be true or false" }
  }
  const aliasEntry = raw.get("aliases")
  const aliases =
    aliasEntry === undefined
      ? { ok: true as const, value: [] }
      : listOf(aliasEntry.first, aliasEntry.rest)
  if (!aliases.ok) return aliases
  const fields: NoteFields = {
    title: title.value,
    type: type.value as NoteType,
    aliases: aliases.value,
    ...(summary.value === undefined || summary.value === "" ? {} : { summary: summary.value }),
    pinned: pinned.value === "true",
  }
  const problem = fieldsProblem(fields)
  if (problem !== undefined) return { ok: false, problem }
  return { ok: true, value: { ...fields, body: split.value.body } }
}

const DATE_TITLE = /^(\d{4})-(\d{2})-(\d{2})$/u

/** Whether `title` is a calendar date written YYYY-MM-DD, the title of a daily note. */
export function isDateTitle(title: string): boolean {
  const match = DATE_TITLE.exec(title)
  if (match === null) return false
  return validDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

export function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number
  return day <= days
}

export const dateTitle = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

/** What makes a note's fields inconsistent, or undefined. */
export function fieldsProblem(fields: NoteFields): string | undefined {
  for (const alias of fields.aliases) {
    const problem = nameProblem(alias)
    if (problem !== undefined) return `the alias "${alias}" ${problem}`
  }
  if (fields.summary !== undefined && /[\r\n]/u.test(fields.summary))
    return "the summary must be one line"
  if (fields.type === "daily") {
    if (!isDateTitle(fields.title)) return "a daily note's title is its date, YYYY-MM-DD"
  } else {
    if (isDateTitle(fields.title))
      return "a title that is a date (YYYY-MM-DD) belongs to a daily note"
    if (fields.summary === undefined)
      return "the summary is missing (every note but a daily one has one)"
  }
  return undefined
}

const PLAIN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^#]*$/u

function quoted(value: string, inList: boolean): string {
  const plain =
    PLAIN.test(value) &&
    value === value.trim() &&
    !value.includes(": ") &&
    !value.endsWith(":") &&
    !(inList && /[,[\]{}]/u.test(value)) &&
    !/^(true|false|null|~|yes|no|on|off|[-+]?[\d.]+(e[-+]?\d+)?)$/iu.test(value)
  return plain ? value : JSON.stringify(value)
}

/** Write a note file; `parseNote` reads it back as the same note. */
export function serializeNote(note: Note): string {
  const lines = [
    "---",
    `title: ${quoted(note.title, false)}`,
    `type: ${note.type}`,
    ...(note.aliases.length === 0
      ? []
      : [`aliases: [${note.aliases.map((alias) => quoted(alias, true)).join(", ")}]`]),
    ...(note.summary === undefined ? [] : [`summary: ${quoted(note.summary, false)}`]),
    ...(note.pinned ? ["pinned: true"] : []),
    "---",
  ]
  return `${lines.join("\n")}\n${note.body === "" ? "" : `${note.body}\n`}`
}
