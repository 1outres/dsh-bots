import { type FoldedText, foldName, foldText, originalRange } from "../text-fold"
import type { NoteCatalog } from "./catalog"
import { linksIn } from "./links"
import { characters, standsAlone } from "./names"
import { dateTitle, validDate } from "./note"

export const MIN_NAME_CHARACTERS = 2

export interface Range {
  readonly start: number
  readonly end: number
}

export type NameTable = ReadonlyMap<string, readonly string[]>

export function nameTable(catalog: NoteCatalog, except?: string): NameTable {
  const table = new Map<string, readonly string[]>()
  for (const id of catalog.ids()) {
    const note = catalog.note(id)
    if (note === undefined || note.type === "daily" || id === except) continue
    for (const name of [note.title, ...note.aliases]) {
      if (characters(name) < MIN_NAME_CHARACTERS) continue
      const key = foldName(name)
      if (table.has(key)) continue
      table.set(
        key,
        catalog
          .named(name)
          .filter((named) => named !== except && catalog.note(named)?.type !== "daily"),
      )
    }
  }
  return table
}

interface Found {
  readonly start: number
  readonly end: number
  readonly key: string
}

function namesIn(folded: FoldedText, table: NameTable): readonly Found[] {
  const byFirst = new Map<string, string[]>()
  for (const key of table.keys()) {
    const first = key.slice(0, 1)
    const list = byFirst.get(first) ?? []
    list.push(key)
    byFirst.set(first, list)
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length)
  const found: Found[] = []
  const { text } = folded
  for (let index = 0; index < text.length; ) {
    const key = (byFirst.get(text.slice(index, index + 1)) ?? []).find(
      (name) => text.startsWith(name, index) && standsAlone(text, index, index + name.length),
    )
    if (key === undefined) {
      index += 1
      continue
    }
    found.push({ ...originalRange(folded, index, index + key.length), key })
    index += key.length
  }
  return found
}

const DATES = [
  /(?<![0-9])([0-9]{4})-([0-9]{2})-([0-9]{2})(?![0-9])/gu,
  /(?<![0-9])([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/gu,
]

function datesIn(folded: FoldedText): readonly Found[] {
  const found: Found[] = []
  for (const pattern of DATES) {
    for (const match of folded.text.matchAll(pattern)) {
      const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
        number,
        number,
        number,
      ]
      if (!validDate(year, month, day)) continue
      found.push({
        ...originalRange(folded, match.index, match.index + match[0].length),
        key: dateTitle(year, month, day),
      })
    }
  }
  return found
}

export type SuggestionTarget =
  | { readonly kind: "notes"; readonly ids: readonly string[] }
  | { readonly kind: "date"; readonly title: string }

export interface Suggestion {
  readonly label: string
  readonly start: number
  readonly end: number
  readonly text: string
  readonly target: SuggestionTarget
}

const inside = (found: Range, ranges: readonly Range[]) =>
  ranges.some((range) => found.start >= range.start && found.end <= range.end)

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end

export function suggestLinks(
  body: string,
  added: readonly Range[],
  table: NameTable,
): readonly Suggestion[] {
  const folded = foldText(body)
  const links = linksIn(body)
  const dates = datesIn(folded)
  const candidates = [
    ...dates.map((found) => ({ found, target: { kind: "date", title: found.key } as const })),
    ...namesIn(folded, table)
      .filter((found) => !dates.some((date) => overlaps(date, found)))
      .map((found) => ({
        found,
        target: { kind: "notes", ids: table.get(found.key) ?? [] } as const,
      })),
  ]
    .filter(({ found }) => inside(found, added) && !links.some((link) => overlaps(link, found)))
    .sort((a, b) => a.found.start - b.found.start)
  const seen = new Set<string>()
  const suggestions: Suggestion[] = []
  for (const { found, target } of candidates) {
    const key = `${target.kind}:${found.key}`
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      label: `L${suggestions.length + 1}`,
      start: found.start,
      end: found.end,
      text: body.slice(found.start, found.end),
      target,
    })
  }
  return suggestions
}

export interface Mention {
  readonly text: string
  readonly ids: readonly string[]
}

export const MAX_MENTIONS = 10

export function mentionsIn(message: string, table: NameTable): readonly Mention[] {
  const seen = new Set<string>()
  const mentions: Mention[] = []
  for (const found of namesIn(foldText(message), table)) {
    if (seen.has(found.key)) continue
    seen.add(found.key)
    mentions.push({ text: message.slice(found.start, found.end), ids: table.get(found.key) ?? [] })
    if (mentions.length === MAX_MENTIONS) break
  }
  return mentions
}
