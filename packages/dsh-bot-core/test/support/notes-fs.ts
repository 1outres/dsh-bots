import type { NotesFileSystem, NoteWriteGuard } from "../../src/host/notes/notebook"

export interface MemoryNotesFs extends NotesFileSystem {
  readonly files: Map<string, { text: string; version: string }>
  put(path: string, text: string): void
  readonly reads: string[]
}

export function memoryNotesFs(): MemoryNotesFs {
  const files = new Map<string, { text: string; version: string }>()
  const reads: string[] = []
  let counter = 0
  const pathOf = (target: object) => (target as { path: string }).path
  const put = (path: string, text: string) => {
    counter += 1
    files.set(path, { text, version: String(counter) })
  }
  const isDirectory = (path: string) => [...files.keys()].some((key) => key.startsWith(`${path}/`))
  return {
    files,
    reads,
    put,
    resolve: async (path, options) => ({
      path: path.startsWith("/") ? path : `${options?.cwd}/${path}`,
    }),
    async stat(target) {
      const path = pathOf(target)
      const file = files.get(path)
      if (file !== undefined)
        return {
          version: file.version,
          type: "file",
          size: new TextEncoder().encode(file.text).length,
        }
      return isDirectory(path) ? { version: "dir", type: "directory" } : undefined
    },
    async listDir(target) {
      const prefix = `${pathOf(target)}/`
      const names = new Map<
        string,
        { name: string; type: "file" | "directory"; version?: string }
      >()
      for (const [path, file] of files) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const name = rest.split("/")[0] as string
        names.set(
          name,
          rest.includes("/")
            ? { name, type: "directory" }
            : { name, type: "file", version: file.version },
        )
      }
      return [...names.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
    async readBytes(target) {
      const path = pathOf(target)
      reads.push(path)
      const file = files.get(path)
      if (file === undefined) throw new Error(`${path}: not found`)
      return new TextEncoder().encode(file.text)
    },
    async writeText(target, content, expected: NoteWriteGuard) {
      const path = pathOf(target)
      const file = files.get(path)
      if (expected.kind === "createIfAbsent" && file !== undefined)
        throw new Error(`${path} exists`)
      if (expected.kind === "replaceIfVersion" && file?.version !== expected.version) {
        throw new Error(`${path} changed since it was read`)
      }
      put(path, content)
      return { version: files.get(path)?.version as string }
    },
  }
}

export function idMaker() {
  let next = 0
  return () => {
    next += 1
    return `0193f2a0-0000-7000-8000-${String(next).padStart(12, "0")}`
  }
}
