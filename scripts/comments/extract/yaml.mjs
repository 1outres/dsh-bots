import { Parser, parseAllDocuments } from "yaml"
import { commentAt, createLocator } from "./locator.mjs"

function commentTokens(tokens) {
  const comments = []
  const pending = [...tokens]
  while (pending.length > 0) {
    const token = pending.pop()
    if (Array.isArray(token)) {
      pending.push(...token)
    } else if (token !== null && typeof token === "object") {
      if (token.type === "comment") comments.push(token)
      pending.push(...Object.values(token))
    }
  }
  return comments.sort((left, right) => left.offset - right.offset)
}

function assertWellFormed(file) {
  const errors = parseAllDocuments(file.text).flatMap((document) => document.errors ?? [])
  if (errors.length > 0) throw new Error(`${file.path}: ${errors[0].message}`)
}

function extractFile(file) {
  assertWellFormed(file)
  const locator = createLocator(file.text)
  return commentTokens([...new Parser().parse(file.text)]).map((token) =>
    commentAt(
      file,
      locator,
      "hash",
      { start: token.offset, end: token.offset + token.source.length },
      token.source.slice(1),
    ),
  )
}

export async function extractYaml(files) {
  return files.map(extractFile)
}
