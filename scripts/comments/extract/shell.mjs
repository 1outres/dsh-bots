import { LangVariant, parse } from "sh-syntax"
import { commentAt, createLocator, createUtf8Index, hashKind } from "./locator.mjs"

function commentNodes(file) {
  const nodes = new Map()
  const pending = [file]
  while (pending.length > 0) {
    const node = pending.pop()
    if (Array.isArray(node)) {
      pending.push(...node)
    } else if (node !== null && typeof node === "object") {
      if (node.type === "Comment") nodes.set(node.start, node)
      pending.push(...Object.values(node))
    }
  }
  return [...nodes.values()].sort((left, right) => left.start - right.start)
}

async function extractFile(file) {
  const tree = await parse(file.text, {
    filepath: file.path,
    keepComments: true,
    variant: LangVariant.LangBash,
  }).catch((error) => {
    throw new Error(`${file.path}: ${error.message}`)
  })
  const locator = createLocator(file.text)
  const indexOf = createUtf8Index(file.text)
  return commentNodes(tree).map((node) => {
    const span = { start: indexOf(node.start), end: indexOf(node.end) }
    const { line, column } = locator.position(span.start)
    const kind = hashKind(line, column, file.text.slice(span.start, span.end))
    return commentAt(file, locator, kind, span, node.text)
  })
}

export async function extractShell(files) {
  const results = []
  for (const file of files) results.push(await extractFile(file))
  return results
}
