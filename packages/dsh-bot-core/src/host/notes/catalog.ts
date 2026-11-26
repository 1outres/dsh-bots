import { foldName } from "../text-fold"
import { linksIn, showBody } from "./links"
import type { Note } from "./note"

export type Resolution =
  | { readonly kind: "note"; readonly id: string }
  | { readonly kind: "ambiguous"; readonly ids: readonly string[] }
  | { readonly kind: "missing" }

export interface Backlink {
  readonly from: string
  readonly line: string
  readonly stored: string
}

export interface InvalidNote {
  readonly file: string
  readonly problem: string
}

export interface NoteCatalog {
  ids(): readonly string[]
  note(id: string): Note | undefined
  titled(name: string): string | undefined
  resolve(name: string): Resolution
  named(name: string): readonly string[]
  links(id: string): readonly string[]
  backlinks(id: string): readonly Backlink[]
  shown(body: string): string
  readonly invalid: readonly InvalidNote[]
}

export function buildCatalog(
  notes: ReadonlyMap<string, Note>,
  invalid: readonly InvalidNote[] = [],
): NoteCatalog {
  const ids = [...notes.keys()].sort()
  const titles = new Map<string, string[]>()
  const aliases = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, name: string, id: string) => {
    const key = foldName(name)
    const list = map.get(key) ?? []
    if (!list.includes(id)) list.push(id)
    map.set(key, list)
  }
  for (const id of ids) {
    const note = notes.get(id) as Note
    add(titles, note.title, id)
    for (const alias of note.aliases) add(aliases, alias, id)
  }
  const titleOf = (id: string) => notes.get(id)?.title
  const shown = (body: string) => showBody(body, titleOf)

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, Backlink[]>()
  for (const id of ids) {
    const note = notes.get(id) as Note
    const targets: string[] = []
    for (const line of note.body.split("\n")) {
      const linked = new Set<string>()
      for (const link of linksIn(line)) {
        if (!targets.includes(link.target)) targets.push(link.target)
        linked.add(link.target)
      }
      for (const target of linked) {
        if (target === id) continue
        const list = incoming.get(target) ?? []
        list.push({ from: id, line: shown(line).trim(), stored: line.trim() })
        incoming.set(target, list)
      }
    }
    outgoing.set(id, targets)
  }

  const named = (name: string) => {
    const key = foldName(name)
    const byTitle = titles.get(key) ?? []
    return [...byTitle, ...(aliases.get(key) ?? []).filter((id) => !byTitle.includes(id))]
  }

  return {
    ids: () => ids,
    note: (id) => notes.get(id),
    titled: (name) => {
      const found = titles.get(foldName(name))
      return found?.length === 1 ? found[0] : undefined
    },
    resolve(name) {
      const byTitle = titles.get(foldName(name)) ?? []
      if (byTitle.length === 1) return { kind: "note", id: byTitle[0] as string }
      if (byTitle.length > 1) return { kind: "ambiguous", ids: byTitle }
      const byAlias = aliases.get(foldName(name)) ?? []
      if (byAlias.length === 1) return { kind: "note", id: byAlias[0] as string }
      if (byAlias.length > 1) return { kind: "ambiguous", ids: byAlias }
      return { kind: "missing" }
    },
    named,
    links: (id) => outgoing.get(id) ?? [],
    backlinks: (id) => incoming.get(id) ?? [],
    shown,
    invalid,
  }
}
