/**
 * Markdown as Discord shows it. Discord renders no tables, no headings below
 * `###` and no horizontal rules, so a reply's tables become aligned code
 * blocks, deeper headings bold lines and rules a line of box drawing.
 * Code blocks are left as they are.
 */

const FENCE = /^\s*(`{3,}|~{3,})/
const SEPARATOR_CELL = /^:?-{1,}:?$/
const DEEP_HEADING = /^\s{0,3}#{4,6}\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const RULE_TEXT = "──────────"

/** Cells of a table row: split at unescaped pipes, outer pipes dropped. */
export function cellsOf(line: string): string[] {
  let body = line.trim()
  if (body.startsWith("|")) body = body.slice(1)
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1)
  const cells: string[] = []
  let current = ""
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string
    if (character === "\\" && body[index + 1] === "|") {
      current += "|"
      index += 1
    } else if (character === "|") {
      cells.push(current)
      current = ""
    } else current += character
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0
}

function isSeparator(line: string): boolean {
  if (!line.includes("-") || !line.includes("|")) {
    return false
  }
  const cells = cellsOf(line)
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell))
}

/** Columns a character takes in a monospace font: two for wide East Asian characters and emoji. */
function columnsOf(character: string): number {
  const code = character.codePointAt(0) ?? 0
  if (code < 0x1100) return 1
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function widthOf(text: string): number {
  let width = 0
  for (const character of text) width += columnsOf(character)
  return width
}

/** Inline emphasis and code marks, which a code block would show literally. */
function plainCell(cell: string): string {
  return cell.replace(/\*\*|__|`/g, "")
}

function renderTable(rows: readonly string[][]): string[] {
  const count = Math.max(...rows.map((row) => row.length))
  const cells = rows.map((row) =>
    Array.from({ length: count }, (_, index) => plainCell(row[index] ?? "")),
  )
  const widths = Array.from({ length: count }, (_, column) =>
    Math.max(1, ...cells.map((row) => widthOf(row[column] ?? ""))),
  )
  const line = (row: readonly string[]) =>
    row
      .map((cell, column) => cell + " ".repeat((widths[column] ?? 0) - widthOf(cell)))
      .join(" | ")
      .trimEnd()
  const [head, ...body] = cells
  return [
    "```",
    line(head ?? []),
    widths.map((width) => "-".repeat(width)).join("-+-"),
    ...body.map(line),
    "```",
  ]
}

export function formatForDiscord(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let fence: string | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    const marker = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      out.push(line)
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined
      continue
    }
    if (marker !== undefined) {
      fence = marker
      out.push(line)
      continue
    }
    const next = lines[index + 1]
    if (isTableRow(line) && next !== undefined && isSeparator(next)) {
      const rows = [cellsOf(line)]
      let end = index + 2
      while (
        end < lines.length &&
        isTableRow(lines[end] as string) &&
        FENCE.exec(lines[end] as string) === null
      ) {
        rows.push(cellsOf(lines[end] as string))
        end += 1
      }
      out.push(...renderTable(rows))
      index = end - 1
      continue
    }
    const heading = DEEP_HEADING.exec(line)
    if (heading !== null) {
      out.push(`**${heading[1]}**`)
      continue
    }
    out.push(RULE.test(line) ? RULE_TEXT : line)
  }
  return out.join("\n")
}
