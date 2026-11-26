import type { InvalidSkill, SkillFile } from "../../shared/skills"
import type { FileTarget } from "../files"
import {
  ARCHIVE_DIRECTORY,
  type Checked,
  MAX_FILE_BYTES,
  nameProblem,
  type ParsedSkill,
  parseSkill,
  SKILL_FILE,
  SKILLS_DIRECTORY,
  SUPPORT_DIRECTORIES,
  skillDirectory,
} from "./skill"

export type SkillWriteGuard =
  | { readonly kind: "createIfAbsent" }
  | { readonly kind: "replaceIfVersion"; readonly version: string }

type EntryType = "file" | "directory" | "other"

export interface SkillsFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FileTarget>
  stat(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    { readonly version: string; readonly type: EntryType; readonly size?: number } | undefined
  >
  listDir(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    readonly {
      readonly name: string
      readonly type: EntryType
      readonly version?: string
      readonly size?: number
    }[]
  >
  readBytes(
    target: FileTarget,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<Uint8Array>
  writeText(
    target: FileTarget,
    content: string,
    expected: SkillWriteGuard,
    signal?: AbortSignal,
  ): Promise<{ readonly version: string }>
  deleteFile(
    target: FileTarget,
    expected: { version: string },
    signal?: AbortSignal,
  ): Promise<unknown>
}

export interface SkillsPlace {
  readonly fs: SkillsFileSystem
  readonly workspace: string
}

export interface CatalogSkill {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly bytes: number
}

export interface SkillCatalog {
  readonly skills: readonly CatalogSkill[]
  readonly invalid: readonly InvalidSkill[]
  readonly fingerprint: string
}

export interface SkillDiskFile extends SkillFile {
  readonly version: string
}

export interface SkillDirectory {
  readonly files: readonly SkillDiskFile[]
  readonly unkept: readonly string[]
}

const decoder = new TextDecoder("utf-8", { fatal: true })

const decode = (bytes: Uint8Array): string | undefined => {
  try {
    return decoder.decode(bytes)
  } catch {
    return undefined
  }
}

export interface SkillLibrary {
  scan(place: SkillsPlace, signal: AbortSignal): Promise<SkillCatalog>
  current(): SkillCatalog | undefined
  archived(
    place: SkillsPlace,
    signal: AbortSignal,
  ): Promise<readonly { readonly name: string; readonly skill: Checked<ParsedSkill> }[]>
  directory(
    place: SkillsPlace,
    name: string,
    archived: boolean,
    signal: AbortSignal,
  ): Promise<SkillDirectory | undefined>
  write(
    place: SkillsPlace,
    path: string,
    text: string,
    guard: SkillWriteGuard,
    signal: AbortSignal,
  ): Promise<string>
  remove(place: SkillsPlace, path: string, version: string, signal: AbortSignal): Promise<void>
}

interface Known {
  readonly version: string
  readonly parsed: Checked<ParsedSkill>
  readonly bytes: number
}

const encoder = new TextEncoder()

export function createSkillLibrary(): SkillLibrary {
  const known = new Map<string, Known>()
  let catalog: SkillCatalog | undefined

  const target = (place: SkillsPlace, path: string, signal: AbortSignal) =>
    place.fs.resolve(path, { cwd: place.workspace, signal })

  const list = async (place: SkillsPlace, path: string, signal: AbortSignal) => {
    const directory = await target(place, path, signal)
    const info = await place.fs.stat(directory, signal)
    if (info === undefined) return []
    if (info.type !== "directory") throw new Error(`${path} in the workspace is not a directory`)
    return place.fs.listDir(directory, signal)
  }

  const readText = async (
    place: SkillsPlace,
    path: string,
    signal: AbortSignal,
  ): Promise<{ version: string; text: string | undefined } | undefined> => {
    const file = await target(place, path, signal)
    const info = await place.fs.stat(file, signal)
    if (info === undefined || info.type !== "file") return undefined
    if (info.size !== undefined && info.size > MAX_FILE_BYTES)
      return { version: info.version, text: undefined }
    return {
      version: info.version,
      text: decode(await place.fs.readBytes(file, signal, MAX_FILE_BYTES)),
    }
  }

  const parsedAt = async (place: SkillsPlace, path: string, signal: AbortSignal) => {
    const read = await readText(place, path, signal)
    if (read === undefined) return undefined
    const parsed: Checked<ParsedSkill> =
      read.text === undefined
        ? { ok: false, problem: `is not UTF-8 text of at most ${MAX_FILE_BYTES / 1024} KiB` }
        : parseSkill(read.text)
    return {
      version: read.version,
      parsed,
      bytes: read.text === undefined ? 0 : encoder.encode(read.text).length,
    }
  }

  return {
    async scan(place, signal) {
      const entries = await list(place, SKILLS_DIRECTORY, signal)
      const skills: CatalogSkill[] = []
      const invalid: InvalidSkill[] = []
      const seen = new Set<string>()
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const path = `${SKILLS_DIRECTORY}/${entry.name}`
        if (entry.type !== "directory") {
          invalid.push({ path, problem: `a skill is a directory <name>/ holding ${SKILL_FILE}` })
          continue
        }
        const file = `${path}/${SKILL_FILE}`
        const info = await place.fs.stat(await target(place, file, signal), signal)
        if (info === undefined) continue
        seen.add(entry.name)
        const previous = known.get(entry.name)
        const current =
          previous !== undefined && previous.version === info.version
            ? previous
            : await parsedAt(place, file, signal)
        if (current === undefined) continue
        known.set(entry.name, current)
        const problem =
          nameProblem(entry.name) ??
          (current.parsed.ok
            ? current.parsed.value.name === entry.name
              ? undefined
              : `its name "${current.parsed.value.name}" differs from its directory "${entry.name}"`
            : current.parsed.problem)
        if (problem !== undefined || !current.parsed.ok) {
          invalid.push({ path: file, problem: problem ?? "is not valid" })
          continue
        }
        skills.push({
          name: entry.name,
          description: current.parsed.value.description,
          version: current.version,
          bytes: current.bytes,
        })
      }
      for (const name of [...known.keys()]) if (!seen.has(name)) known.delete(name)
      skills.sort((a, b) => a.name.localeCompare(b.name))
      const fingerprint = JSON.stringify([
        skills.map((skill) => [skill.name, skill.version]),
        invalid.map((entry) => [entry.path, entry.problem]),
      ])
      catalog = { skills, invalid, fingerprint }
      return catalog
    },
    current: () => catalog,
    async archived(place, signal) {
      const entries = await list(place, `${SKILLS_DIRECTORY}/${ARCHIVE_DIRECTORY}`, signal)
      const found: { name: string; skill: Checked<ParsedSkill> }[] = []
      for (const entry of entries) {
        if (entry.type !== "directory" || nameProblem(entry.name) !== undefined) continue
        const read = await parsedAt(
          place,
          `${skillDirectory(entry.name, true)}/${SKILL_FILE}`,
          signal,
        )
        if (read !== undefined) found.push({ name: entry.name, skill: read.parsed })
      }
      return found.sort((a, b) => a.name.localeCompare(b.name))
    },
    async directory(place, name, archived, signal) {
      const root = skillDirectory(name, archived)
      const skill = await readText(place, `${root}/${SKILL_FILE}`, signal)
      if (skill === undefined) return undefined
      const files: SkillDiskFile[] = []
      const unkept: string[] = []
      const take = (path: string, read: { version: string; text: string | undefined }) => {
        if (read.text === undefined) unkept.push(path)
        else files.push({ path, text: read.text, version: read.version })
      }
      take(SKILL_FILE, skill)
      const walk = async (relative: string): Promise<void> => {
        for (const entry of await list(place, `${root}/${relative}`, signal)) {
          const path = `${relative}/${entry.name}`
          if (entry.type === "directory") await walk(path)
          else if (entry.type === "file") {
            const read = await readText(place, `${root}/${path}`, signal)
            if (read !== undefined) take(path, read)
          } else unkept.push(path)
        }
      }
      for (const entry of await list(place, root, signal)) {
        if (entry.name === SKILL_FILE) continue
        if (
          entry.type === "directory" &&
          (SUPPORT_DIRECTORIES as readonly string[]).includes(entry.name)
        ) {
          await walk(entry.name)
        } else unkept.push(entry.type === "directory" ? `${entry.name}/` : entry.name)
      }
      return { files, unkept }
    },
    async write(place, path, text, guard, signal) {
      const outcome = await place.fs.writeText(
        await target(place, path, signal),
        text,
        guard,
        signal,
      )
      return outcome.version
    },
    async remove(place, path, version, signal) {
      await place.fs.deleteFile(await target(place, path, signal), { version }, signal)
    },
  }
}
