import { commentAt, createLocator } from "./locator.mjs"

const QUOTES = new Set(['"', "`"])

function skipQuoted(text, start) {
  const quote = text[start]
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === "\\") index++
    else if (text[index] === quote) return index + 1
  }
  throw new Error(`unterminated ${quote} literal at offset ${start}`)
}

function lineCommentEnd(text, start) {
  const newline = text.indexOf("\n", start)
  return newline === -1 ? text.length : newline
}

function blockCommentEnd(text, start) {
  const close = text.indexOf("*/", start + 2)
  if (close === -1) throw new Error(`unterminated block comment at offset ${start}`)
  return close + 2
}

function scan(text) {
  const spans = []
  let index = 0
  while (index < text.length) {
    const pair = text.slice(index, index + 2)
    if (QUOTES.has(text[index])) {
      index = skipQuoted(text, index)
    } else if (pair === "//") {
      const end = lineCommentEnd(text, index)
      spans.push({ kind: "line", start: index, end, body: text.slice(index + 2, end) })
      index = end
    } else if (pair === "/*") {
      const end = blockCommentEnd(text, index)
      spans.push({ kind: "block", start: index, end, body: text.slice(index + 2, end - 2) })
      index = end
    } else {
      index++
    }
  }
  return spans
}

function extractFile(file) {
  const locator = createLocator(file.text)
  try {
    return scan(file.text).map((span) =>
      commentAt(file, locator, span.kind, { start: span.start, end: span.end }, span.body),
    )
  } catch (error) {
    throw new Error(`${file.path}: ${error.message}`)
  }
}

export async function extractGrit(files) {
  return files.map(extractFile)
}
