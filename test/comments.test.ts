import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { loadBiomeRules } from "../scripts/comments/biome-rules.mjs"
import { checkSources } from "../scripts/comments/checker.mjs"
import type { Diagnostic, LanguageId, RuleNumber } from "../scripts/comments/contract.mjs"
import { isGenerated, isTestPath, languageOf } from "../scripts/comments/files.mjs"
import { applyFixes } from "../scripts/comments/rewrite.mjs"

interface ExpectedDiagnostic {
  readonly line: number
  readonly column: number
  readonly rule: RuleNumber
  readonly fixable: boolean
}

interface Expectation {
  readonly path: string
  readonly diagnostics: readonly ExpectedDiagnostic[]
}

const root = fileURLToPath(new URL("..", import.meta.url))
const fixtures = join(root, "test", "fixtures", "comments")
const checker = join(root, "scripts", "comments", "check.mjs")
const context = { biomeRules: loadBiomeRules() }

const cases = readdirSync(fixtures, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => join(entry.parentPath, entry.name).slice(fixtures.length + 1, -".json".length))
  .sort()

function languageFor(path: string, text: string): LanguageId {
  const language = languageOf(path, text)
  if (language === null) throw new Error(`${path} is not checked for comments`)
  return language
}

async function diagnosticsOf(path: string, text: string): Promise<readonly Diagnostic[]> {
  const [report] = await checkSources([{ path, language: languageFor(path, text), text }], context)
  return report.diagnostics
}

function summary(diagnostic: Diagnostic): ExpectedDiagnostic {
  return {
    line: diagnostic.line,
    column: diagnostic.column,
    rule: diagnostic.rule,
    fixable: diagnostic.fix !== null,
  }
}

function fixture(name: string) {
  const read = (suffix: string) => readFileSync(join(fixtures, `${name}${suffix}`), "utf8")
  return {
    expectation: JSON.parse(read(".json")) as Expectation,
    source: read(".fixture"),
    written: read(".written"),
  }
}

describe("comment fixtures", () => {
  it.each(cases)("%s reports exactly its expected diagnostics", async (name) => {
    const { expectation, source } = fixture(name)
    const diagnostics = await diagnosticsOf(expectation.path, source)
    expect(diagnostics.map(summary)).toEqual(expectation.diagnostics)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.message.startsWith(`Design rule ${diagnostic.rule}: `)).toBe(true)
    }
  })

  it.each(cases)("%s is rewritten to its .written file by --write", async (name) => {
    const { expectation, source, written } = fixture(name)
    const diagnostics = await diagnosticsOf(expectation.path, source)
    expect(applyFixes(source, diagnostics)).toBe(written)
  })

  it.each(cases)("%s keeps only its unfixable diagnostics once rewritten", async (name) => {
    const { expectation, written } = fixture(name)
    const remaining = await diagnosticsOf(expectation.path, written)
    expect(remaining.map((diagnostic) => diagnostic.fix)).toEqual(remaining.map(() => null))
    expect(remaining.map((diagnostic) => diagnostic.rule)).toEqual(
      expectation.diagnostics
        .filter((diagnostic) => !diagnostic.fixable)
        .map((diagnostic) => diagnostic.rule),
    )
  })

  it("cover every rule and language", () => {
    const expectations = cases.map((name) => fixture(name).expectation)
    const rules = new Set(expectations.flatMap((item) => item.diagnostics.map((d) => d.rule)))
    expect([...rules].sort()).toEqual([73, 74, 75])
    expect(new Set(cases.map((name) => dirname(name)))).toEqual(
      new Set(["ecmascript", "grit", "python", "shell", "yaml"]),
    )
  })
})

describe("checked files", () => {
  it.each([
    ["packages/a/src/x.ts", "", "ecmascript"],
    ["packages/a/src/x.tsx", "", "ecmascript"],
    ["packages/a/src/x.mts", "", "ecmascript"],
    ["packages/a/src/x.cts", "", "ecmascript"],
    ["dev/x.js", "", "ecmascript"],
    ["scripts/x.mjs", "", "ecmascript"],
    ["scripts/x.cjs", "", "ecmascript"],
    [".biome/plugins/01-x.grit", "", "grit"],
    ["infra/x.sh", "", "shell"],
    ["vm/agent/x.py", "", "python"],
    [".github/workflows/ci.yml", "", "yaml"],
    ["pnpm-workspace.yaml", "", "yaml"],
    ["vm/bin/start", "#!/bin/sh\n", "shell"],
    ["vm/bin/run", "#!/usr/bin/env bash\n", "shell"],
    ["vm/bin/plain", "echo\n", null],
    ["vm/bin/node-tool", "#!/usr/bin/env node\n", null],
    ["test/fixtures/comments/shell/x.fixture", "#!/bin/sh\n", null],
    ["packages/a/test/__snapshots__/x.test.ts.snap", "// x\n", null],
    ["pnpm-lock.yaml", "", null],
    ["README.md", "", null],
  ])("%s is checked as %s", (path, text, language) => {
    expect(languageOf(path, text)).toBe(language)
  })

  it("treats snapshots and the lockfile as generated", () => {
    expect(isGenerated("packages/a/test/__snapshots__/x.snap")).toBe(true)
    expect(isGenerated("pnpm-lock.yaml")).toBe(true)
    expect(isGenerated("pnpm-workspace.yaml")).toBe(false)
  })

  it.each([
    ["packages/a/test/x.ts", true],
    ["test/fixtures/lint/packages/a/src/x.ts", true],
    ["packages/a/src/x.test.ts", true],
    ["packages/a/src/x.test.tsx", true],
    ["packages/a/src/test.ts", false],
    ["packages/a/src/tests/x.ts", false],
    ["packages/a/src/x.spec.ts", false],
  ])("%s is a test file: %s", (path, expected) => {
    expect(isTestPath(path)).toBe(expected)
  })
})

describe("unparsable files", () => {
  it.each([
    ["packages/a/src/x.ts", "const = 1\n"],
    [".biome/plugins/01-x.grit", '`$x` where { $x <: "open\n'],
    ["infra/x.sh", "if true; then\n"],
    ["vm/x.py", "def f(:\n  '''open\n"],
    [".github/workflows/x.yml", "a: [1\n"],
  ])("%s fails the check instead of being skipped", async (path, text) => {
    await expect(diagnosticsOf(path, text)).rejects.toThrow(path)
  })
})

describe("Biome rule catalog", () => {
  it("names every rule as lint/<group>/<rule>", () => {
    expect(context.biomeRules.has("lint/suspicious/noExplicitAny")).toBe(true)
    expect(context.biomeRules.has("lint/a11y/useKeyWithClickEvents")).toBe(true)
    expect(context.biomeRules.has("lint/style/noRestrictedImports")).toBe(true)
    expect(
      [...context.biomeRules].every((rule) => /^lint\/[a-z0-9]+\/[A-Za-z0-9]+$/.test(rule)),
    ).toBe(true)
  })
})

describe("check.mjs", () => {
  const repositories: string[] = []

  afterEach(() => {
    for (const repository of repositories.splice(0))
      rmSync(repository, { recursive: true, force: true })
  })

  function repository(files: Record<string, string>): string {
    const directory = mkdtempSync(join(tmpdir(), "comments-cli-"))
    repositories.push(directory)
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true })
      writeFileSync(join(directory, path), text)
    }
    return directory
  }

  function git(directory: string, ...args: string[]) {
    const run = spawnSync("git", args, { cwd: directory, encoding: "utf8" })
    expect(run.status, run.stderr).toBe(0)
  }

  function check(directory: string, ...args: string[]) {
    return spawnSync(process.execPath, [checker, ...args], { cwd: directory, encoding: "utf8" })
  }

  it("checks tracked files only and rewrites the fixable comments", () => {
    const directory = repository({
      ".gitignore": "generated/\n",
      "src/a.ts": "// explains a\nexport const a = 1\n",
      "src/b.ts": "// @ts-ignore\nexport const b: number = 1\n",
      "generated/c.ts": "// generated\nexport const c = 1\n",
      "untracked.ts": "// untracked\n",
      "bin/run": "#!/bin/sh\n# runs\nexec true\n",
      "bin/notes": "# not a script\n",
      "src/__snapshots__/a.test.ts.snap": "// snapshot\n",
    })
    git(directory, "init", "-q")
    git(directory, "add", ".gitignore", "src", "bin")
    git(directory, "add", "-f", "generated/c.ts")

    const first = check(directory)
    expect(first.status).toBe(1)
    expect(first.stderr).toContain("src/a.ts:1:1 Design rule 73: ")
    expect(first.stderr).toContain("src/b.ts:1:1 Design rule 75: ")
    expect(first.stderr).toContain("bin/run:2:1 Design rule 73: ")
    expect(first.stderr).not.toContain("generated/")
    expect(first.stderr).not.toContain("untracked")
    expect(first.stderr).not.toContain("notes")
    expect(first.stderr).not.toContain(".snap")

    const written = check(directory, "--write")
    expect(written.status).toBe(1)
    expect(readFileSync(join(directory, "src/a.ts"), "utf8")).toBe("export const a = 1\n")
    expect(readFileSync(join(directory, "bin/run"), "utf8")).toBe("#!/bin/sh\nexec true\n")
    expect(readFileSync(join(directory, "src/b.ts"), "utf8")).toContain("// @ts-ignore")
    expect(written.stderr).toContain("src/b.ts:1:1 Design rule 75: ")
    expect(written.stderr).not.toContain("src/a.ts")

    writeFileSync(join(directory, "src/b.ts"), "export const b: number = 1\n")
    const clean = check(directory)
    expect(clean.status).toBe(0)
    expect(clean.stderr).toBe("")
  })

  it("refuses unknown arguments", () => {
    const directory = repository({})
    git(directory, "init", "-q")
    expect(check(directory, "--fix").status).toBe(2)
  })
})
