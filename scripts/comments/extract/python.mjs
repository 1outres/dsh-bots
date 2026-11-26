import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { codePointIndex, commentAt, createLocator, hashKind } from "./locator.mjs"

const TOKENIZER = fileURLToPath(new URL("./python_comments.py", import.meta.url))

function tokenize(files) {
  const run = spawnSync("python3", ["-I", TOKENIZER], {
    input: JSON.stringify(files.map((file) => ({ path: file.path, source: file.text }))),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
  if (run.error !== undefined) throw run.error
  if (run.status !== 0) throw new Error(`python3 tokenize failed: ${run.stderr.trim()}`)
  return JSON.parse(run.stdout)
}

function commentOf(file, locator, token) {
  const start = codePointIndex(file.text, locator.lineStart(token.line), token.column)
  const span = { start, end: start + token.text.length }
  const kind = hashKind(token.line, token.column + 1, token.text)
  return commentAt(file, locator, kind, span, token.text.slice(1))
}

export async function extractPython(files) {
  if (files.length === 0) return []
  return tokenize(files).map((tokens, index) => {
    const file = files[index]
    const locator = createLocator(file.text)
    return tokens.map((token) => commentOf(file, locator, token))
  })
}
