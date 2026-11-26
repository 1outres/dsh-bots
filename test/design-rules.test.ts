import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("..", import.meta.url))
const fixtures = join(root, "test", "fixtures", "lint")
const expectations = JSON.parse(
  readFileSync(join(root, "test", "fixtures", "lint.expected.json"), "utf8"),
) as Record<string, readonly string[]>
const biome = join(root, "node_modules", ".bin", "biome")

const LINT_RULES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 64, 65, 68, 69, 70, 71, 72,
]

interface Diagnostic {
  category: string
  message: string
  location?: { path?: string; start?: { line: number } }
}

const RULE_OF_CATEGORY: Record<string, number> = { "lint/style/noRestrictedGlobals": 26 }

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}

function expectedFindings(file: string): readonly string[] {
  const findings = expectations[file]
  if (findings === undefined) throw new Error(`${file} has no entry in lint.expected.json`)
  return findings
}

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

  it("list every fixture in lint.expected.json, and nothing else", () => {
    expect(Object.keys(expectations).sort()).toEqual(files)
  })

  it.each(files)("%s reports exactly its expected lines", (file) => {
    const expected = expectedFindings(file)
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
        expectedFindings(file).map((finding) => Number(finding.split(":")[1])),
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

  it.each(plugins)("%s states its rule number in its name and in every message", (name) => {
    const prefix = /^(\d{2})-[a-z0-9-]+\.grit$/.exec(name)?.[1]
    expect(prefix).toBeDefined()
    const source = readFileSync(join(root, ".biome", "plugins", name), "utf8")
    const messages = [...source.matchAll(/message = "Design rule (\d+): /g)].map(
      (match) => match[1],
    )
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.map(Number)).toEqual(messages.map(() => Number(prefix)))
    expect(source.match(/message = /g)?.length).toBe(messages.length)
  })
})
