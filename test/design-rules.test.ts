import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Design rules enforced by Biome (noRestrictedImports, noRestrictedGlobals and
 * the GritQL plugins under .biome/plugins). A GritQL pattern that is written
 * wrong matches nothing and passes silently, so every rule is run here against
 * fixtures that must and must not trip it.
 *
 * Fixtures live in test/fixtures/lint, laid out like the repository (the
 * plugin `includes` and override globs are repository paths). Every line that
 * must be reported ends with a `rule: <numbers>` comment; every other line must
 * stay silent. The tree is copied to a
 * temporary directory together with biome.json and .biome, and linted there.
 */

const root = fileURLToPath(new URL("..", import.meta.url))
const fixtures = join(root, "test", "fixtures", "lint")
const biome = join(root, "node_modules", ".bin", "biome")

/** Rules Biome enforces; the others are structure tests (test/design-rules-structure.test.ts). */
const LINT_RULES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 64, 65,
]

interface Diagnostic {
  category: string
  message: string
  location?: { path?: string; start?: { line: number } }
}

/**
 * noRestrictedGlobals prints a fixed message and the configured one only as a
 * note the JSON report leaves out; in this repository it carries rule 26 only.
 */
const RULE_OF_CATEGORY: Record<string, number> = { "lint/style/noRestrictedGlobals": 26 }

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}

/** "line:rule" for every `rule: N...` marker of a fixture. */
function expectedFindings(source: string): string[] {
  return source.split("\n").flatMap((text, index) => {
    const marker = /(?:\/\/|\/\*) rule: ([\d ]+)/.exec(text)?.[1]
    return marker === undefined
      ? []
      : marker
          .trim()
          .split(/\s+/)
          .map((rule) => `${index + 1}:${rule}`)
  })
}

/** The design rule a diagnostic reports. */
function ruleOf(diagnostic: Diagnostic): number | undefined {
  const number = /^Design rule (\d+):/.exec(diagnostic.message)?.[1]
  return number === undefined ? RULE_OF_CATEGORY[diagnostic.category] : Number(number)
}

let workspace: string
let diagnostics: Diagnostic[]

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "design-rules-"))
  cpSync(fixtures, workspace, { recursive: true })
  cpSync(join(root, ".biome"), join(workspace, ".biome"), { recursive: true })
  const config = JSON.parse(readFileSync(join(root, "biome.json"), "utf8"))
  config.$schema = undefined
  config.vcs = { enabled: false }
  config.files = { includes: ["**"] }
  writeFileSync(join(workspace, "biome.json"), JSON.stringify(config))
  const run = spawnSync(biome, ["lint", "--reporter=json", "--max-diagnostics=none", "."], {
    cwd: workspace,
    encoding: "utf8",
  })
  const start = run.stdout.indexOf('{"summary"')
  if (start < 0) throw new Error(`biome produced no report:\n${run.stdout}\n${run.stderr}`)
  diagnostics = (JSON.parse(run.stdout.slice(start)) as { diagnostics: Diagnostic[] }).diagnostics
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe("design rule lint fixtures", () => {
  const files = filesUnder(fixtures)

  it("load every plugin without errors", () => {
    const broken = diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.category === "plugin" || diagnostic.category.startsWith("deserialize"),
      )
      .filter((diagnostic) => ruleOf(diagnostic) === undefined)
      .map((diagnostic) => `${diagnostic.location?.path}: ${diagnostic.message}`)
    expect([...new Set(broken)]).toEqual([])
  })

  it.each(files)("%s reports exactly its marked lines", (file) => {
    const expected = expectedFindings(readFileSync(join(fixtures, file), "utf8"))
    const found = diagnostics
      .filter((diagnostic) => diagnostic.location?.path === file)
      .flatMap((diagnostic) => {
        const rule = ruleOf(diagnostic)
        return rule === undefined ? [] : [`${diagnostic.location?.start?.line}:${rule}`]
      })
    expect([...new Set(found)].sort()).toEqual([...new Set(expected)].sort())
  })

  it("cover every lint rule with a violating fixture", () => {
    const covered = new Set(
      files.flatMap((file) =>
        expectedFindings(readFileSync(join(fixtures, file), "utf8")).map((finding) =>
          Number(finding.split(":")[1]),
        ),
      ),
    )
    expect(LINT_RULES.filter((rule) => !covered.has(rule))).toEqual([])
  })
})

describe("design rule configuration", () => {
  const config = JSON.parse(readFileSync(join(root, "biome.json"), "utf8")) as {
    plugins: { path: string }[]
  }
  const plugins = readdirSync(join(root, ".biome", "plugins")).filter((name) =>
    name.endsWith(".grit"),
  )

  it("enables every GritQL plugin file exactly once", () => {
    const enabled = config.plugins.map((plugin) =>
      plugin.path.replace(/^\.\/\.biome\/plugins\//, ""),
    )
    expect([...enabled].sort()).toEqual([...plugins].sort())
  })

  it.each(plugins)("%s states its rule number in its header and its message", (name) => {
    const number = Number(name.slice(0, 2))
    const source = readFileSync(join(root, ".biome", "plugins", name), "utf8")
    expect(source.startsWith(`// Design rule ${number}`)).toBe(true)
    expect(source).toContain(`message = "Design rule ${number}: `)
  })
})
