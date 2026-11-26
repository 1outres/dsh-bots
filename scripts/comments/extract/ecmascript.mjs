import { extname } from "node:path"
import { parseSync } from "oxc-parser"
import { commentAt, createLocator } from "./locator.mjs"

const DIALECTS = {
  ".ts": { lang: "ts", sourceType: "module" },
  ".mts": { lang: "ts", sourceType: "module" },
  ".cts": { lang: "ts", sourceType: "commonjs" },
  ".tsx": { lang: "tsx", sourceType: "module" },
  ".js": { lang: "js", sourceType: "unambiguous" },
  ".mjs": { lang: "js", sourceType: "module" },
  ".cjs": { lang: "js", sourceType: "commonjs" },
  ".jsx": { lang: "jsx", sourceType: "module" },
}

function dialectOf(path) {
  const dialect = DIALECTS[extname(path)]
  if (dialect === undefined) throw new Error(`${path}: not a JavaScript or TypeScript file`)
  return /\.d\.[cm]?ts$/.test(path) ? { ...dialect, lang: "dts" } : dialect
}

function emptyJsxContainers(program) {
  const containers = []
  const pending = [program]
  while (pending.length > 0) {
    const node = pending.pop()
    if (Array.isArray(node)) {
      pending.push(...node)
    } else if (node !== null && typeof node === "object") {
      if (node.type === "JSXExpressionContainer" && node.expression.type === "JSXEmptyExpression") {
        containers.push({ start: node.start, end: node.end })
      }
      pending.push(...Object.values(node))
    }
  }
  return containers
}

function extractFile(file) {
  const dialect = dialectOf(file.path)
  const result = parseSync(file.path, file.text, dialect)
  if (result.errors.length > 0) {
    throw new Error(`${file.path}: ${result.errors[0].message}`)
  }
  const locator = createLocator(file.text)
  const containers = dialect.lang.endsWith("x") ? emptyJsxContainers(result.program) : []
  const containerOf = (comment) =>
    containers.find((container) => container.start < comment.start && comment.end < container.end)
  const loneInContainer = (container) =>
    result.comments.filter(
      (comment) => container.start < comment.start && comment.end < container.end,
    ).length === 1
  const hashbang = result.program.hashbang
  const comments = result.comments
    .filter((comment) => hashbang === null || comment.start >= hashbang.end)
    .map((comment) => {
      if (comment.type === "Line") {
        return commentAt(
          file,
          locator,
          "line",
          { start: comment.start, end: comment.end },
          comment.value,
        )
      }
      const container = containerOf(comment)
      return container !== undefined && loneInContainer(container)
        ? commentAt(file, locator, "jsx", container, comment.value)
        : commentAt(
            file,
            locator,
            "block",
            { start: comment.start, end: comment.end },
            comment.value,
          )
    })
  return hashbang === null
    ? comments
    : [
        commentAt(
          file,
          locator,
          "hashbang",
          { start: hashbang.start, end: hashbang.end },
          hashbang.value,
        ),
        ...comments,
      ]
}

export async function extractEcmascript(files) {
  return files.map(extractFile)
}
