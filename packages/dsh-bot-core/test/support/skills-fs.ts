import type { BotTable } from "../../src/host/registry"
import type { SkillsFileSystem } from "../../src/host/skills/library"
import { type MemoryNotesFs, memoryNotesFs } from "./notes-fs"

export interface MemorySkillsFs
  extends SkillsFileSystem,
    Pick<MemoryNotesFs, "files" | "put" | "reads"> {}

export function memorySkillsFs(): MemorySkillsFs {
  const base = memoryNotesFs()
  return {
    ...base,
    async deleteFile(target, expected) {
      const path = (target as { path: string }).path
      if (base.files.get(path)?.version !== expected.version) throw new Error(`${path} changed`)
      base.files.delete(path)
      return { before: null }
    },
  }
}

export function memoryTable<V>(): BotTable<V> & { readonly rows: Map<string, V> } {
  const rows = new Map<string, V>()
  return {
    rows,
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    async put(key, value) {
      rows.set(key, value)
    },
    async delete(key) {
      return rows.delete(key)
    },
  }
}
