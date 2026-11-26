import { SPACE_LIMITS } from "../../shared/spaces"
import type { FileTarget } from "../files"
import {
  contentTypeOf,
  SPACE_ENTRY,
  type SpacePathProblem,
  segmentProblem,
  spaceDirectoryOf,
} from "./paths"

export interface SnapshotFs {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FileTarget>
  contains(parent: FileTarget, child: FileTarget): boolean
  lstat(
    path: string,
    options?: { cwd?: string },
    signal?: AbortSignal,
  ): Promise<
    | { readonly type: "file" | "directory" | "symlink" | "other"; readonly size?: number }
    | undefined
  >
  listDir(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    readonly {
      readonly name: string
      readonly type: "file" | "directory" | "other"
      readonly size?: number
    }[]
  >
  readBytes(
    target: FileTarget,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<Uint8Array>
}

export interface SnapshotFile {
  readonly path: string
  readonly type: string
  readonly data: Uint8Array
}

export type SnapshotResult =
  | { readonly ok: true; readonly files: readonly SnapshotFile[]; readonly bytes: number }
  | { readonly ok: false; readonly violations: readonly string[] }

const MAX_DEPTH = 16

const PROBLEM_TEXT: Readonly<Record<SpacePathProblem, string>> = {
  segment: "has a name outside A-Z, a-z, 0-9, '.', '_' and '-'",
  hidden: "is hidden",
  reserved: "uses the reserved name _dsh",
  type: "has an extension Spaces do not serve",
}

const MIB = 1024 * 1024

const mib = (bytes: number) => `${Math.round((bytes / MIB) * 10) / 10} MiB`

export async function readSnapshot(
  fs: SnapshotFs,
  workspace: string,
  slug: string,
  signal: AbortSignal,
): Promise<SnapshotResult> {
  const directory = spaceDirectoryOf(slug)
  const top = await fs.lstat(directory, { cwd: workspace }, signal)
  if (top?.type !== "directory") {
    return { ok: false, violations: [`${directory}/ is not a directory in your workspace`] }
  }
  const root = await fs.resolve(directory, { cwd: workspace, signal })
  const violations: string[] = []
  const found: { path: string; type: string; target: FileTarget }[] = []
  let total = 0

  const walk = async (target: FileTarget, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      violations.push(`${prefix} is nested deeper than ${MAX_DEPTH} directories`)
      return
    }
    for (const entry of await fs.listDir(target, signal)) {
      const path = `${prefix}${entry.name}`
      if (entry.name.startsWith(".")) continue
      const problem = segmentProblem(entry.name, prefix === "")
      if (problem !== undefined) {
        violations.push(`${path} ${PROBLEM_TEXT[problem]}`)
        continue
      }
      const info = await fs.lstat(`${directory}/${path}`, { cwd: workspace }, signal)
      if (info === undefined) continue
      if (info.type === "symlink") {
        violations.push(`${path} is a symbolic link; publish the file itself`)
        continue
      }
      const child = await fs.resolve(`${directory}/${path}`, { cwd: workspace, signal })
      if (!fs.contains(root, child)) {
        violations.push(`${path} resolves outside ${directory}/`)
        continue
      }
      if (info.type === "directory") {
        await walk(child, `${path}/`, depth + 1)
        continue
      }
      if (info.type !== "file") {
        violations.push(`${path} is not a regular file`)
        continue
      }
      const type = contentTypeOf(path)
      if (type === undefined) {
        violations.push(`${path} ${PROBLEM_TEXT.type}`)
        continue
      }
      const size = info.size ?? entry.size ?? 0
      if (size > SPACE_LIMITS.fileBytes) {
        violations.push(
          `${path} has ${mib(size)}, more than ${mib(SPACE_LIMITS.fileBytes)} per file`,
        )
        continue
      }
      total += size
      found.push({ path, type, target: child })
    }
  }

  await walk(root, "", 0)
  if (found.length > SPACE_LIMITS.filesPerRevision) {
    violations.push(
      `${found.length} files, more than ${SPACE_LIMITS.filesPerRevision} per revision`,
    )
  }
  if (total > SPACE_LIMITS.revisionBytes) {
    violations.push(
      `${mib(total)} in all, more than ${mib(SPACE_LIMITS.revisionBytes)} per revision`,
    )
  }
  if (!found.some((file) => file.path === SPACE_ENTRY)) {
    violations.push(`there is no ${directory}/${SPACE_ENTRY}, the page a Space opens with`)
  }
  if (violations.length > 0) return { ok: false, violations }
  const files: SnapshotFile[] = []
  let bytes = 0
  for (const file of found.sort((left, right) => (left.path < right.path ? -1 : 1))) {
    const data = await fs.readBytes(file.target, signal, SPACE_LIMITS.fileBytes + 1)
    if (data.length > SPACE_LIMITS.fileBytes) {
      return {
        ok: false,
        violations: [`${file.path} grew past ${mib(SPACE_LIMITS.fileBytes)} while it was read`],
      }
    }
    bytes += data.length
    files.push({ path: file.path, type: file.type, data })
  }
  if (bytes > SPACE_LIMITS.revisionBytes) {
    return {
      ok: false,
      violations: [
        `${mib(bytes)} in all, more than ${mib(SPACE_LIMITS.revisionBytes)} per revision`,
      ],
    }
  }
  return { ok: true, files, bytes }
}
