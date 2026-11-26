import { classifyComment } from "./directives.mjs"
import { EXTRACTORS } from "./extract/index.mjs"
import { isTestPath } from "./files.mjs"
import { evaluate } from "./rules/index.mjs"

function reportOf(file, comments, context) {
  const ruleContext = { isTest: isTestPath(file.path), biomeRules: context.biomeRules }
  const diagnostics = comments.flatMap((comment) => {
    const diagnostic = evaluate(comment, classifyComment(comment, file.language), ruleContext)
    return diagnostic === null ? [] : [diagnostic]
  })
  return { file, comments, diagnostics }
}

function byLanguage(sources) {
  const groups = new Map()
  for (const source of sources) {
    groups.set(source.language, [...(groups.get(source.language) ?? []), source])
  }
  return groups
}

export async function checkSources(sources, context) {
  const reports = []
  for (const [language, files] of byLanguage(sources)) {
    const comments = await EXTRACTORS[language](files)
    files.forEach((file, index) => {
      reports.push(reportOf(file, comments[index], context))
    })
  }
  return reports.sort((left, right) => left.file.path.localeCompare(right.file.path))
}
