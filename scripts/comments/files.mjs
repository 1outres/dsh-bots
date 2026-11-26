import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { basename, extname, join } from "node:path"

const EXTENSION_LANGUAGES = {
  ".ts": "ecmascript",
  ".tsx": "ecmascript",
  ".mts": "ecmascript",
  ".cts": "ecmascript",
  ".js": "ecmascript",
  ".mjs": "ecmascript",
  ".cjs": "ecmascript",
  ".grit": "grit",
  ".sh": "shell",
  ".py": "python",
  ".yml": "yaml",
  ".yaml": "yaml",
}

const INTERPRETER_LANGUAGES = { sh: "shell", bash: "shell" }

const GENERATED_FILES = new Set(["pnpm-lock.yaml"])

const GENERATED_EXTENSIONS = new Set([".snap"])

export function isGenerated(path) {
  return GENERATED_FILES.has(basename(path)) || GENERATED_EXTENSIONS.has(extname(path))
}

function interpreterOf(text) {
  const shebang = /^#![ \t]*(\S+)(?:[ \t]+(\S+))?/.exec(text)
  if (shebang === null) return null
  const program = basename(shebang[1])
  return program === "env" && shebang[2] !== undefined ? basename(shebang[2]) : program
}

export function extensionLanguageOf(path) {
  if (isGenerated(path)) return null
  return EXTENSION_LANGUAGES[extname(path)] ?? null
}

export function needsShebang(path) {
  return !basename(path).includes(".")
}

export function languageOf(path, text) {
  if (needsShebang(path)) return INTERPRETER_LANGUAGES[interpreterOf(text)] ?? null
  return extensionLanguageOf(path)
}

function gitPaths(root, args) {
  const run = spawnSync("git", ["ls-files", "-z", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error !== undefined) throw run.error
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr.trim()}`)
  return run.stdout.split("\0").filter((path) => path !== "")
}

export function repositoryRoot(directory) {
  const run = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    encoding: "utf8",
  })
  if (run.error !== undefined) throw run.error
  if (run.status !== 0) throw new Error(`not a git repository: ${directory}`)
  return run.stdout.trim()
}

export function trackedPaths(root) {
  const skipped = new Set([
    ...gitPaths(root, ["--cached", "--ignored", "--exclude-standard"]),
    ...gitPaths(root, ["--deleted"]),
  ])
  return gitPaths(root, ["--cached"])
    .filter((path) => !skipped.has(path))
    .sort()
}

export function readSources(root, paths) {
  return paths.flatMap((path) => {
    if (!needsShebang(path) && extensionLanguageOf(path) === null) return []
    const text = readFileSync(join(root, path), "utf8")
    const language = languageOf(path, text)
    return language === null ? [] : [{ path, language, text }]
  })
}

export function isTestPath(path) {
  const segments = path.split("/")
  return segments.slice(0, -1).includes("test") || /\.test\.tsx?$/.test(segments.at(-1))
}
