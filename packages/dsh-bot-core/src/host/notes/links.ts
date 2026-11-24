/**
 * Links in a note's body (docs/specs/bot-notes.md §2). In a file a link names
 * its note by id, `[[<id>|<text>]]`, or `[[<id>]]` when the text is the title;
 * the model reads and writes the same links with titles, `[[<title>|<text>]]`.
 */

export interface LinkSpan {
  readonly start: number
  readonly end: number
  /** What the link names: an id in a file, a title or alias in what the model writes. */
  readonly target: string
  /** The text shown, when it is not the target's title. */
  readonly text?: string
}

const LINK = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/gu

export function linksIn(body: string): readonly LinkSpan[] {
  return [...body.matchAll(LINK)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    target: (match[1] as string).trim(),
    ...(match[2] === undefined ? {} : { text: match[2] }),
  }))
}

export const MISSING_NOTE = "(missing note)"

/** Replace each link by what `replace` makes of it. */
export function mapLinks(body: string, replace: (link: LinkSpan) => string): string {
  let out = ""
  let at = 0
  for (const link of linksIn(body)) {
    out += body.slice(at, link.start) + replace(link)
    at = link.end
  }
  return out + body.slice(at)
}

/** A link as the model reads it: the target's title instead of its id. */
export function shownLink(title: string | undefined, text: string | undefined): string {
  if (title === undefined) return `[[${MISSING_NOTE}${text === undefined ? "" : `|${text}`}]]`
  return text === undefined || text === title ? `[[${title}]]` : `[[${title}|${text}]]`
}

/** A link as a file keeps it: `text` is dropped when it is the title. */
export function storedLink(id: string, title: string, text: string | undefined): string {
  return text === undefined || text === title ? `[[${id}]]` : `[[${id}|${text}]]`
}

/** Text with every link as the words it shows: its text, else its target's title. */
export function plainLinks(text: string, titleOf: (id: string) => string | undefined): string {
  return mapLinks(text, (link) => link.text ?? titleOf(link.target) ?? MISSING_NOTE)
}

/** Body with every link as the model reads it. */
export function showBody(body: string, titleOf: (id: string) => string | undefined): string {
  return mapLinks(body, (link) => shownLink(titleOf(link.target), link.text))
}
