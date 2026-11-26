import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { PLUGIN_PREFIX, readManifest, SCOPE } from "./packages"

export const CORE_PACKAGE = `${SCOPE}/${PLUGIN_PREFIX}core`

function sourceFiles(directory: string): string[] {
  const src = join(directory, "src")
  if (!existsSync(src)) return []
  return readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}

const CORE_IMPORT = new RegExp(`from\\s+["']${CORE_PACKAGE.replace("/", "\\/")}(?:/[^"']*)?["']`)

export function coreDependencyProblems(directory: string): string[] {
  const importers = sourceFiles(directory).filter((file) =>
    CORE_IMPORT.test(readFileSync(join(directory, file), "utf8")),
  )
  if (importers.length === 0) return []
  const problems: string[] = []
  const manifest = readManifest(directory)
  if (
    manifest.dependencies?.[CORE_PACKAGE] === undefined &&
    manifest.peerDependencies?.[CORE_PACKAGE] === undefined
  ) {
    problems.push(
      `${importers[0]} imports ${CORE_PACKAGE}, which neither dependencies nor peerDependencies lists`,
    )
  }
  const entry = join(directory, "src", "index.ts")
  const source = existsSync(entry) ? readFileSync(entry, "utf8") : ""
  const inject = /export\s+const\s+inject\s*(?::[^=]+)?=\s*\[([^\]]*)\]/.exec(source)?.[1]
  if (inject === undefined) {
    problems.push("src/index.ts does not export const inject = [...]")
  } else if (!/["']bot["']|\bBOT_SERVICE\b/.test(inject)) {
    problems.push('src/index.ts inject does not list "bot"')
  }
  return problems
}

export function channelIdProblems(directory: string, directoryName: string): string[] {
  const expected = directoryName.slice(PLUGIN_PREFIX.length)
  const literal = [
    /registerChannel\(\s*\{[^}]*?\bid\s*:\s*["'`]([^"'`$]+)["'`]/g,
    /:\s*BotChannel\s*=\s*\{[^}]*?\bid\s*:\s*["'`]([^"'`$]+)["'`]/g,
  ]
  const problems: string[] = []
  for (const file of sourceFiles(directory)) {
    const source = readFileSync(join(directory, file), "utf8")
    for (const pattern of literal) {
      for (const match of source.matchAll(pattern)) {
        if (match[1] !== expected) {
          problems.push(`${file} registers channel "${match[1]}"; expected "${expected}"`)
        }
      }
    }
  }
  return problems
}
