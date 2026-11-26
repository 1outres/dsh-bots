const BIOME_IGNORE = /^\s*biome-ignore(?:-(all|start|end))?(?=[\s:]|$)(.*)$/s
const BIOME_CATEGORY = /^\s*([^\s:]*)\s*(?::(.*))?$/s
const TYPESCRIPT = /^[\s/*]*@(ts-expect-error|ts-ignore|ts-nocheck)(?![\w-])(.*)$/s
const NOQA = /^\s*noqa(?![\w-])(.*)$/is
const NOQA_CODES = /^\s*:(.*)$/s
const NOQA_CODE = /^[A-Z]+[0-9]+$/
const SHELLCHECK = /^\s*shellcheck\s+(\S+)/

function biomeIgnore(body) {
  const match = BIOME_IGNORE.exec(body)
  if (match === null) return null
  const [, category, reason] = BIOME_CATEGORY.exec(match[2])
  return {
    kind: "biome-ignore",
    variant: match[1] === undefined ? "ignore" : `ignore-${match[1]}`,
    category,
    reason: reason === undefined ? null : reason.trim(),
  }
}

function typescript(body) {
  const match = TYPESCRIPT.exec(body)
  return match === null
    ? null
    : { kind: "typescript", name: match[1], description: match[2].trim() }
}

function noqaCodes(rest) {
  const list = NOQA_CODES.exec(rest)
  if (list === null) return null
  const words = list[1].trim().split(/[\s,]+/)
  const end = words.findIndex((word) => !NOQA_CODE.test(word))
  const codes = end === -1 ? words : words.slice(0, end)
  return codes.length === 0 ? null : codes
}

function noqa(body) {
  const match = NOQA.exec(body)
  return match === null ? null : { kind: "noqa", codes: noqaCodes(match[1]) }
}

function shellcheck(body) {
  const match = SHELLCHECK.exec(body)
  if (match === null) return null
  const separator = match[1].indexOf("=")
  return separator === -1
    ? { kind: "shellcheck", key: match[1], value: "" }
    : {
        kind: "shellcheck",
        key: match[1].slice(0, separator),
        value: match[1].slice(separator + 1),
      }
}

const RECOGNIZERS = {
  ecmascript: [biomeIgnore, typescript],
  grit: [],
  shell: [shellcheck],
  python: [noqa],
  yaml: [],
}

export function classifyComment(comment, language) {
  if (comment.kind === "hashbang") return { kind: "hashbang" }
  for (const recognize of RECOGNIZERS[language]) {
    const directive = recognize(comment.body)
    if (directive !== null) return directive
  }
  return { kind: "prose" }
}
