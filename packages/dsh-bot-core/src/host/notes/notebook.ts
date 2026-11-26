import type { FileTarget } from "../files"
import { buildCatalog, type InvalidNote, type NoteCatalog } from "./catalog"
import {
  NOTES_DIRECTORY,
  type Note,
  noteFileName,
  noteIdOf,
  type Parsed,
  parseNote,
  serializeNote,
} from "./note"

export const MAX_NOTE_BYTES = 256 * 1024

export type NoteWriteGuard =
  | { readonly kind: "createIfAbsent" }
  | { readonly kind: "replaceIfVersion"; readonly version: string }

export interface NotesFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FileTarget>
  stat(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    | {
        readonly version: string
        readonly type: "file" | "directory" | "other"
        readonly size?: number
      }
    | undefined
  >
  listDir(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    readonly {
      readonly name: string
      readonly type: "file" | "directory" | "other"
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
    expected: NoteWriteGuard,
    signal?: AbortSignal,
  ): Promise<{ readonly version: string }>
}

export interface NotesPlace {
  readonly fs: NotesFileSystem
  readonly workspace: string
}

interface Entry {
  readonly version: string
  readonly text: string
  readonly parsed: Parsed<Note>
}

export interface NotesView {
  readonly catalog: NoteCatalog
  text(id: string): string | undefined
}

export interface Notebook {
  load(place: NotesPlace, signal: AbortSignal): Promise<NotesView>
  write(
    place: NotesPlace,
    id: string,
    note: Note,
    mode: "create" | "replace",
    signal: AbortSignal,
  ): Promise<NotesView>
  current(): NotesView | undefined
}

const decoder = new TextDecoder("utf-8", { fatal: true })

export function createNotebook(): Notebook {
  const entries = new Map<string, Entry>()
  let view: NotesView | undefined

  const rebuild = (): NotesView => {
    const notes = new Map<string, Note>()
    const invalid: InvalidNote[] = []
    for (const [id, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      if (entry.parsed.ok) notes.set(id, entry.parsed.value)
      else
        invalid.push({
          file: `${NOTES_DIRECTORY}/${noteFileName(id)}`,
          problem: entry.parsed.problem,
        })
    }
    const catalog = buildCatalog(notes, invalid)
    view = { catalog, text: (id) => entries.get(id)?.text }
    return view
  }

  const read = async (
    place: NotesPlace,
    target: FileTarget,
    size: number,
    signal: AbortSignal,
  ): Promise<{ text: string; parsed: Parsed<Note> }> => {
    if (size > MAX_NOTE_BYTES) {
      return {
        text: "",
        parsed: { ok: false, problem: `is larger than ${MAX_NOTE_BYTES / 1024} KiB` },
      }
    }
    const bytes = await place.fs.readBytes(target, signal, MAX_NOTE_BYTES)
    let text: string
    try {
      text = decoder.decode(bytes)
    } catch {
      return { text: "", parsed: { ok: false, problem: "is not UTF-8 text" } }
    }
    return { text, parsed: parseNote(text) }
  }

  return {
    async load(place, signal) {
      const directory = await place.fs.resolve(NOTES_DIRECTORY, { cwd: place.workspace, signal })
      const info = await place.fs.stat(directory, signal)
      if (info !== undefined && info.type !== "directory") {
        throw new Error(`${NOTES_DIRECTORY} in the workspace is not a directory`)
      }
      const listed = info === undefined ? [] : await place.fs.listDir(directory, signal)
      const present = new Set<string>()
      let changed = view === undefined
      for (const file of listed) {
        const id = noteIdOf(file.name)
        if (id === undefined || file.type !== "file") continue
        present.add(id)
        const target = await place.fs.resolve(`${NOTES_DIRECTORY}/${file.name}`, {
          cwd: place.workspace,
          signal,
        })
        const info =
          file.version !== undefined && file.size !== undefined
            ? { version: file.version, size: file.size }
            : await place.fs.stat(target, signal)
        if (info === undefined) continue
        if (entries.get(id)?.version === info.version) continue
        if (info.size === undefined)
          throw new Error(`the size of ${NOTES_DIRECTORY}/${file.name} is unknown`)
        entries.set(id, {
          version: info.version,
          ...(await read(place, target, info.size, signal)),
        })
        changed = true
      }
      for (const id of [...entries.keys()]) {
        if (present.has(id)) continue
        entries.delete(id)
        changed = true
      }
      return changed || view === undefined ? rebuild() : view
    },
    async write(place, id, note, mode, signal) {
      const text = serializeNote(note)
      const target = await place.fs.resolve(`${NOTES_DIRECTORY}/${noteFileName(id)}`, {
        cwd: place.workspace,
        signal,
      })
      const known = entries.get(id)
      if (mode === "replace" && known === undefined)
        throw new Error(`note ${id} is not in the notes directory`)
      const guard: NoteWriteGuard =
        mode === "create"
          ? { kind: "createIfAbsent" }
          : { kind: "replaceIfVersion", version: (known as Entry).version }
      const outcome = await place.fs.writeText(target, text, guard, signal)
      entries.set(id, { version: outcome.version, text, parsed: { ok: true, value: note } })
      return rebuild()
    },
    current: () => view,
  }
}
