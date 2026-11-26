export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href?: string; readonly children: readonly Inline[] }
  | { readonly kind: "note"; readonly target: string; readonly text?: string }

export type Block =
  | {
      readonly kind: "heading"
      readonly level: 1 | 2 | 3 | 4 | 5 | 6
      readonly content: readonly Inline[]
    }
  | { readonly kind: "paragraph"; readonly content: readonly Inline[] }
  | { readonly kind: "code"; readonly language?: string; readonly text: string }
  | {
      readonly kind: "list"
      readonly ordered: boolean
      readonly start?: number
      readonly items: readonly (readonly Inline[])[]
    }
  | { readonly kind: "quote"; readonly blocks: readonly Block[] }
  | { readonly kind: "rule" }

export interface MarkdownOptions {
  readonly noteLinks?: boolean
}

const NOTE_LINK = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/y

const SAFE_URL = /^(https?:|mailto:)/i

const AUTOLINK = /https?:\/\/[^\s<>]*[^\s<>.,:;"'!?)\]]/y

export function safeHref(url: string): string | undefined {
  const trimmed = url.trim()
  return SAFE_URL.test(trimmed) ? trimmed : undefined
}

const MAX_DEPTH = 4

function forwardSearch(text: string) {
  const last = new Map<string, number>()
  return (token: string, from: number): number => {
    const known = last.get(token)
    if (known !== undefined && (known === -1 || known >= from)) return known
    const found = text.indexOf(token, from)
    last.set(token, found)
    return found
  }
}

export function parseInline(
  text: string,
  options: MarkdownOptions = {},
  depth = 0,
  inLink = false,
): Inline[] {
  const out: Inline[] = []
  const find = forwardSearch(text)
  let buffer = ""
  let plain = 0
  const flush = (to: number) => {
    buffer += text.slice(plain, to)
    if (buffer !== "") out.push({ kind: "text", text: buffer })
    buffer = ""
  }
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === "`") {
      let run = 1
      while (text[i + run] === "`") run += 1
      const fence = "`".repeat(run)
      const close = find(fence, i + run)
      if (close === -1) {
        i += run
        continue
      }
      flush(i)
      const body = text.slice(i + run, close)
      out.push({
        kind: "code",
        text: /^ .* $/.test(body) && body.trim() !== "" ? body.slice(1, -1) : body,
      })
      i = close + run
      plain = i
      continue
    }
    if ((char === "*" || char === "_") && depth < MAX_DEPTH) {
      const strong = text[i + 1] === char
      const marker = strong ? char + char : char
      const open = i + marker.length
      const leftOk = char === "*" || !/\w/.test(text[i - 1] ?? "")
      const close = leftOk && /\S/.test(text[open] ?? "") ? find(marker, open + 1) : -1
      if (close !== -1 && /\S/.test(text[close - 1] ?? "")) {
        flush(i)
        const children = parseInline(text.slice(open, close), options, depth + 1, inLink)
        out.push(strong ? { kind: "strong", children } : { kind: "em", children })
        i = close + marker.length
        plain = i
        continue
      }
      i += marker.length
      continue
    }
    if (char === "[" && options.noteLinks === true && text[i + 1] === "[") {
      NOTE_LINK.lastIndex = i
      const link = NOTE_LINK.exec(text)
      if (link !== null) {
        flush(i)
        out.push({
          kind: "note",
          target: (link[1] as string).trim(),
          ...(link[2] === undefined ? {} : { text: link[2] }),
        })
        i += link[0].length
        plain = i
        continue
      }
    }
    if (char === "h" && !inLink && !/[\w/]/.test(text[i - 1] ?? "")) {
      AUTOLINK.lastIndex = i
      const url = AUTOLINK.exec(text)?.[0]
      if (url !== undefined) {
        flush(i)
        out.push({ kind: "link", href: url, children: [{ kind: "text", text: url }] })
        i += url.length
        plain = i
        continue
      }
    }
    if (char === "[") {
      const closeLabel = find("]", i + 1)
      if (closeLabel !== -1 && text[closeLabel + 1] === "(") {
        const closeUrl = find(")", closeLabel + 2)
        if (closeUrl !== -1) {
          const target =
            text
              .slice(closeLabel + 2, closeUrl)
              .trim()
              .split(/\s+/)[0] ?? ""
          flush(i)
          const href = safeHref(target)
          out.push({
            kind: "link",
            ...(href === undefined ? {} : { href }),
            children: parseInline(
              text.slice(i + 1, closeLabel),
              options,
              Math.max(depth, MAX_DEPTH - 1),
              true,
            ),
          })
          i = closeUrl + 1
          plain = i
          continue
        }
      }
      i += 1
      continue
    }
    i += 1
  }
  flush(text.length)
  return out
}

export const MARKDOWN_RENDER_LIMIT = 256 * 1024

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^ {0,3}[-*+]\s+(.*)$/
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/

function headingText(rest: string): string {
  let end = rest.length
  while (end > 0 && /\s/.test(rest[end - 1] ?? "")) end -= 1
  let hashes = end
  while (hashes > 0 && rest[hashes - 1] === "#") hashes -= 1
  if (hashes < end && (hashes === 0 || /\s/.test(rest[hashes - 1] ?? ""))) end = hashes
  return rest.slice(0, end).trim()
}

const MAX_QUOTE_DEPTH = 8

export function parseMarkdown(source: string, options: MarkdownOptions = {}, depth = 0): Block[] {
  const inline = (text: string) => parseInline(text, options)
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.trim() === "") {
      i += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? "```"
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker)) {
        body.push(lines[i] ?? "")
        i += 1
      }
      i += 1
      const language = fence[2] ?? ""
      blocks.push({ kind: "code", ...(language === "" ? {} : { language }), text: body.join("\n") })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({
        kind: "heading",
        level,
        content: inline(headingText(line.slice(heading[0].length))),
      })
      i += 1
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" })
      i += 1
      continue
    }
    if (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i] ?? "")
        if (quoted === null) break
        body.push(quoted[1] ?? "")
        i += 1
      }
      blocks.push({ kind: "quote", blocks: parseMarkdown(body.join("\n"), options, depth + 1) })
      continue
    }
    const first = ORDERED.exec(line)
    const ordered = first !== null
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? ORDERED : BULLET
      const items: Inline[][] = []
      let current: string[] = []
      while (i < lines.length) {
        const text = lines[i] ?? ""
        const item = pattern.exec(text)
        if (item !== null) {
          if (current.length > 0) items.push(inline(current.join(" ")))
          current = [(ordered ? item[2] : item[1]) ?? ""]
        } else if (text.trim() !== "" && /^\s+/.test(text)) {
          current.push(text.trim())
        } else {
          break
        }
        i += 1
      }
      if (current.length > 0) items.push(inline(current.join(" ")))
      const start = first === null ? 1 : Number(first[1])
      blocks.push({ kind: "list", ordered, ...(start === 1 ? {} : { start }), items })
      continue
    }
    const body: string[] = []
    while (i < lines.length) {
      const text = lines[i] ?? ""
      if (
        text.trim() === "" ||
        FENCE.test(text) ||
        HEADING.test(text) ||
        RULE.test(text) ||
        (depth < MAX_QUOTE_DEPTH && QUOTE.test(text)) ||
        BULLET.test(text) ||
        ORDERED.test(text)
      ) {
        break
      }
      body.push(text.trim())
      i += 1
    }
    blocks.push({ kind: "paragraph", content: inline(body.join(" ")) })
  }
  return blocks
}
