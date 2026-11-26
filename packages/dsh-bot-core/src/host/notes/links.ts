export interface LinkSpan {
  readonly start: number
  readonly end: number
  readonly target: string
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

export function mapLinks(body: string, replace: (link: LinkSpan) => string): string {
  let out = ""
  let at = 0
  for (const link of linksIn(body)) {
    out += body.slice(at, link.start) + replace(link)
    at = link.end
  }
  return out + body.slice(at)
}

export function shownLink(title: string | undefined, text: string | undefined): string {
  if (title === undefined) return `[[${MISSING_NOTE}${text === undefined ? "" : `|${text}`}]]`
  return text === undefined || text === title ? `[[${title}]]` : `[[${title}|${text}]]`
}

export function storedLink(id: string, title: string, text: string | undefined): string {
  return text === undefined || text === title ? `[[${id}]]` : `[[${id}|${text}]]`
}

export function plainLinks(text: string, titleOf: (id: string) => string | undefined): string {
  return mapLinks(text, (link) => link.text ?? titleOf(link.target) ?? MISSING_NOTE)
}

export function showBody(body: string, titleOf: (id: string) => string | undefined): string {
  return mapLinks(body, (link) => shownLink(titleOf(link.target), link.text))
}
