import { existsSync, readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { describe, expect, it } from "vitest"
// @ts-expect-error -- plain .mjs build helper without type declarations
import { hostBuildOptions } from "../scripts/build-options.mjs"
import { pluginDirectoryNames } from "./support/packages"

/**
 * Host entries bundle only their own package: another package's code in a
 * built lib/*.js would run as a second copy and drag that package's
 * dependencies along, which a profile install cannot resolve.
 */

const root = fileURLToPath(new URL("..", import.meta.url))

function hostEntries(directory: string): string[] {
  const entries: string[] = []
  const index = join(directory, "src", "index.ts")
  if (existsSync(index)) entries.push(index)
  const plugins = join(directory, "src", "plugins")
  if (existsSync(plugins)) {
    for (const file of readdirSync(plugins).filter((name) => name.endsWith(".ts"))) {
      entries.push(join(plugins, file))
    }
  }
  return entries
}

async function metafileOf(entry: string) {
  const result = await build({
    ...hostBuildOptions(entry, "out.js"),
    write: false,
    metafile: true,
    logLevel: "silent",
  })
  if (result.metafile === undefined) throw new Error(`esbuild wrote no metafile for ${entry}`)
  return result.metafile
}

/** Source files esbuild put into the bundle, relative to the repository. */
async function bundledSources(entry: string): Promise<string[]> {
  return Object.keys((await metafileOf(entry)).inputs)
}

/** Packages a built bundle imports at run time (type-only imports are erased). */
async function runtimeImports(entry: string): Promise<string[]> {
  const outputs = Object.values((await metafileOf(entry)).outputs)
  return outputs.flatMap((output) =>
    output.imports.filter((item) => item.external).map((item) => item.path),
  )
}

const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")

const isBuiltin = (specifier: string) =>
  specifier.startsWith("node:") || builtinModules.includes(packageOf(specifier))

describe.each(pluginDirectoryNames(root))("%s host bundles", (name) => {
  it("contain no other package's code", async () => {
    const foreign: string[] = []
    for (const entry of hostEntries(join(root, "packages", name))) {
      for (const source of await bundledSources(entry)) {
        if (!source.startsWith(`packages/${name}/`)) foreign.push(`${entry}: ${source}`)
      }
    }
    expect(foreign).toEqual([])
  })

  it("import at run time only packages their manifest installs", async () => {
    const directory = join(root, "packages", name)
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    const undeclared: string[] = []
    for (const entry of hostEntries(directory)) {
      for (const specifier of await runtimeImports(entry)) {
        if (!isBuiltin(specifier) && !declared.has(packageOf(specifier))) {
          undeclared.push(`${entry}: ${specifier}`)
        }
      }
    }
    expect(undeclared).toEqual([])
  })
})
