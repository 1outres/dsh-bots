const OPENERS = ["{", "(", "["]
const CLOSERS = ["}", ")", "]"]
const WORD = /[\p{L}\p{N}_$]/u

function lineBounds(text, start, end) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1
  const newline = text.indexOf("\n", end)
  return { lineStart, lineEnd: newline === -1 ? text.length : newline, newline }
}

function leadingWhitespace(text) {
  return text.length - text.trimStart().length
}

function trailingWhitespace(text) {
  return text.length - text.trimEnd().length
}

function lineEndingAt(text, at) {
  if (at === 0) return null
  const start = text.lastIndexOf("\n", at - 2) + 1
  return { start, end: at, content: text.slice(start, at - 1) }
}

function lineStartingAt(text, at) {
  if (at === text.length) return null
  const newline = text.indexOf("\n", at)
  const end = newline === -1 ? text.length : newline + 1
  return { start: at, end, content: text.slice(at, newline === -1 ? text.length : newline) }
}

function isBlank(line) {
  return line !== null && line.content.trim() === ""
}

function opens(line) {
  return OPENERS.some((opener) => line.content.trimEnd().endsWith(opener))
}

function closes(line) {
  return CLOSERS.some((closer) => line.content.trimStart().startsWith(closer))
}

function removeLines(text, from, to) {
  const joined = text.slice(0, from) + text.slice(to)
  const previous = lineEndingAt(joined, from)
  const next = lineStartingAt(joined, from)
  if (isBlank(next) && (previous === null || isBlank(previous) || opens(previous))) {
    return joined.slice(0, next.start) + joined.slice(next.end)
  }
  if (isBlank(previous) && (next === null || closes(next))) {
    return joined.slice(0, previous.start) + joined.slice(previous.end)
  }
  return joined
}

function joinAround(text, start, end) {
  return WORD.test(text[start - 1] ?? "") && WORD.test(text[end] ?? "") ? " " : ""
}

function removeSpan(text, { start, end }) {
  const { lineStart, lineEnd, newline } = lineBounds(text, start, end)
  const before = text.slice(lineStart, start)
  const after = text.slice(end, lineEnd)
  const ownsLineStart = before.trim() === ""
  const ownsLineEnd = after.trim() === ""
  if (ownsLineStart && ownsLineEnd) {
    return removeLines(text, lineStart, newline === -1 ? text.length : newline + 1)
  }
  if (ownsLineEnd) return text.slice(0, start - trailingWhitespace(before)) + text.slice(lineEnd)
  const gapAfter = leadingWhitespace(after)
  if (ownsLineStart || gapAfter > 0) return text.slice(0, start) + text.slice(end + gapAfter)
  const from = start - trailingWhitespace(before)
  return text.slice(0, from) + joinAround(text, from, end) + text.slice(end)
}

function applyEdit(text, { span, fix }) {
  return fix.kind === "replace"
    ? text.slice(0, span.start) + fix.text + text.slice(span.end)
    : removeSpan(text, span)
}

export function applyFixes(text, diagnostics) {
  const edits = diagnostics
    .filter((diagnostic) => diagnostic.fix !== null)
    .map((diagnostic) => ({ span: diagnostic.span, fix: diagnostic.fix }))
    .sort((left, right) => right.span.start - left.span.start)
  edits.forEach((edit, index) => {
    const following = edits[index - 1]
    if (following !== undefined && edit.span.end > following.span.start) {
      throw new Error(`overlapping fixes at offsets ${edit.span.start} and ${following.span.start}`)
    }
  })
  return edits.reduce(applyEdit, text)
}
