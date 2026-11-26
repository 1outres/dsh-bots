export function formatDiagnostic(diagnostic) {
  const fixable = diagnostic.fix === null ? "" : " (fixable with --write)"
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}${fixable}`
}

export function formatSummary(diagnostics) {
  const counts = new Map()
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.rule, (counts.get(diagnostic.rule) ?? 0) + 1)
  }
  const perRule = [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rule, count]) => `rule ${rule}: ${count}`)
    .join(", ")
  const fixable = diagnostics.filter((diagnostic) => diagnostic.fix !== null).length
  return `${diagnostics.length} comments break design rules 73-75 (${perRule}); ${fixable} are fixable with --write.`
}
