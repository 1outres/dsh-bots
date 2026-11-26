#!/usr/bin/env node
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadBiomeRules } from "./biome-rules.mjs"
import { checkSources } from "./checker.mjs"
import { readSources, repositoryRoot, trackedPaths } from "./files.mjs"
import { formatDiagnostic, formatSummary } from "./report.mjs"
import { applyFixes } from "./rewrite.mjs"

const USAGE = "usage: check.mjs [--write]"

function modeOf(args) {
  if (args.length === 0) return "check"
  if (args.length === 1 && args[0] === "--write") return "write"
  console.error(USAGE)
  process.exit(2)
}

function writeFixes(root, reports) {
  const changed = reports.flatMap((report) => {
    const text = applyFixes(report.file.text, report.diagnostics)
    if (text === report.file.text) return []
    writeFileSync(join(root, report.file.path), text)
    return [report.file.path]
  })
  console.log(`Rewrote ${changed.length} files.`)
}

const mode = modeOf(process.argv.slice(2))
const root = repositoryRoot(process.cwd())
const context = { biomeRules: loadBiomeRules() }
const paths = trackedPaths(root)
const first = await checkSources(readSources(root, paths), context)
if (mode === "write") writeFixes(root, first)
const reports = mode === "write" ? await checkSources(readSources(root, paths), context) : first
const diagnostics = reports.flatMap((report) => report.diagnostics)
for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic))
if (diagnostics.length > 0) {
  console.error(formatSummary(diagnostics))
  process.exit(1)
}
console.log(`${reports.length} files: no comments outside design rules 73-75.`)
