export const SKILLS_DIRECTORY = "skills"
export const ARCHIVE_DIRECTORY = ".archive"
export const SKILL_FILE = "SKILL.md"
export const SUPPORT_DIRECTORIES = ["references", "templates", "scripts", "assets"] as const

export const MAX_NAME_LENGTH = 64
export const MAX_DESCRIPTION_LENGTH = 500
export const DESCRIPTION_TARGET_BYTES = 160
export const MAX_FILE_BYTES = 64 * 1024
export const MAX_SKILL_BYTES = 512 * 1024
export const MAX_SKILL_FILES = 64

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER_KEYS = ["name", "description"] as const

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string }

export interface SkillHeader {
  readonly name: string
  readonly description: string
}

export interface ParsedSkill extends SkillHeader {
  readonly body: string
}

const encoder = new TextEncoder()
export const byteLength = (text: string): number => encoder.encode(text).length

export function nameProblem(name: string): string | undefined {
  if (name.length === 0) return "the name is empty"
  if (name.length > MAX_NAME_LENGTH) return `the name is longer than ${MAX_NAME_LENGTH} characters`
  if (!NAME.test(name)) {
    return `"${name}" is not kebab-case (lowercase letters and digits joined by single hyphens)`
  }
  return undefined
}

function scalar(raw: string): Checked<string> {
  const value = raw.trim()
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === "string") return { ok: true, value: parsed }
    } catch {}
    return { ok: false, problem: `${value} is not a valid double-quoted string` }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      return { ok: false, problem: `${value} is not a valid single-quoted string` }
    }
    return { ok: true, value: value.slice(1, -1).replaceAll("''", "'") }
  }
  if (/^[|>]/.test(value))
    return {
      ok: false,
      problem: "block scalars (| or >) are not accepted; write the value on one line",
    }
  return { ok: true, value }
}

export const normalized = (text: string): string => text.replaceAll("\r\n", "\n")

export function parseSkill(source: string): Checked<ParsedSkill> {
  const text = normalized(source)
  if (!text.startsWith("---\n"))
    return { ok: false, problem: "SKILL.md must start with a --- frontmatter line" }
  const end = text.indexOf("\n---", 3)
  if (end < 0 || (text[end + 4] !== undefined && text[end + 4] !== "\n")) {
    return { ok: false, problem: "the frontmatter has no closing --- line" }
  }
  const fields = new Map<string, string>()
  for (const line of text.slice(4, end).split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue
    const match = /^([A-Za-z][\w-]*):(.*)$/.exec(line)
    if (match === null)
      return { ok: false, problem: `frontmatter line "${line}" is not "key: value"` }
    const key = match[1] as string
    const raw = match[2] as string
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        problem: `unknown frontmatter key "${key}"; only name and description are accepted`,
      }
    }
    if (fields.has(key)) return { ok: false, problem: `frontmatter key "${key}" appears twice` }
    const value = scalar(raw)
    if (!value.ok) return { ok: false, problem: `${key}: ${value.problem}` }
    fields.set(key, value.value)
  }
  const name = fields.get("name")
  const description = fields.get("description")?.trim()
  if (name === undefined) return { ok: false, problem: "the frontmatter has no name" }
  const invalidName = nameProblem(name)
  if (invalidName !== undefined) return { ok: false, problem: `name: ${invalidName}` }
  if (description === undefined || description === "") {
    return { ok: false, problem: "the frontmatter has no description" }
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      problem: `the description is longer than ${MAX_DESCRIPTION_LENGTH} characters`,
    }
  }
  const body = text.slice(end + 4).replace(/^\n/, "")
  if (body.trim() === "")
    return { ok: false, problem: "SKILL.md has no instructions after the frontmatter" }
  return { ok: true, value: { name, description, body } }
}

export function descriptionWarning(description: string): string | undefined {
  const bytes = byteLength(description)
  return bytes > DESCRIPTION_TARGET_BYTES
    ? `The description is ${bytes} bytes; aim for at most ${DESCRIPTION_TARGET_BYTES}: the situations that call for the skill first, then what it produces.`
    : undefined
}

export function supportPathProblem(path: string): string | undefined {
  if (path === SKILL_FILE) return `${SKILL_FILE} is not a supporting file`
  if (path.includes("\\")) return "use / to separate the parts of a path"
  const parts = path.split("/")
  if (
    parts.length < 2 ||
    !(SUPPORT_DIRECTORIES as readonly string[]).includes(parts[0] as string)
  ) {
    return `supporting files go under ${SUPPORT_DIRECTORIES.map((dir) => `${dir}/`).join(", ")}`
  }
  if (parts.some((part) => part === "" || part.startsWith("."))) {
    return "a path part may not be empty or start with a dot"
  }
  if (path.length > 200) return "the path is longer than 200 characters"
  return undefined
}

export function sizeProblem(
  files: readonly { readonly path: string; readonly text: string }[],
): string | undefined {
  if (files.length > MAX_SKILL_FILES) return `a skill holds at most ${MAX_SKILL_FILES} files`
  let total = 0
  for (const file of files) {
    const bytes = byteLength(file.text)
    if (bytes > MAX_FILE_BYTES) return `${file.path} is larger than ${MAX_FILE_BYTES / 1024} KiB`
    total += bytes
  }
  return total > MAX_SKILL_BYTES
    ? `the skill's files are larger than ${MAX_SKILL_BYTES / 1024} KiB together`
    : undefined
}

export const skillDirectory = (name: string, archived: boolean): string =>
  archived ? `${SKILLS_DIRECTORY}/${ARCHIVE_DIRECTORY}/${name}` : `${SKILLS_DIRECTORY}/${name}`

export function sameFiles(
  left: readonly { readonly path: string; readonly text: string }[],
  right: readonly { readonly path: string; readonly text: string }[],
): boolean {
  if (left.length !== right.length) return false
  const texts = new Map(left.map((file) => [file.path, file.text]))
  return right.every((file) => texts.get(file.path) === file.text)
}
