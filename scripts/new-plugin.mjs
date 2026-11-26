#!/usr/bin/env node
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isMap, isSeq, parseDocument, Scalar } from "yaml"

const SCOPE = "@1outres"
const BUNDLE_DIRECTORY = "dsh-bots"
const REPOSITORY_URL = "git+https://github.com/1outres/dsh-bots.git"
const PLACEHOLDER_TILE = "#6B7280"

export function titleOf(name) {
  const words = name.split("-")
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ")
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function manifestOf(packageName, directoryName, name, bundleManifest) {
  return {
    name: packageName,
    version: bundleManifest.version,
    description: `TODO: describe the ${name} plugin for DeepSeek Harness in one sentence.`,
    repository: { type: "git", url: REPOSITORY_URL, directory: `packages/${directoryName}` },
    type: "module",
    main: "lib/index.js",
    exports: {
      ".": "./lib/index.js",
      "./client": "./lib/client.js",
      "./locale/*.json": "./locale/*.json",
      "./icon": "./icon.svg",
      "./package.json": "./package.json",
    },
    files: ["lib", "cordis.patch.yml", "locale/*.json", "icon.svg"],
    scripts: { prepublishOnly: "node ../../scripts/build.mjs" },
    keywords: ["dsh", "dsh-plugin", name, "deepseek-harness"],
    license: "MIT",
    publishConfig: { access: "public" },
    engines: bundleManifest.engines,
    peerDependencies: { "@deepseek-ai/cordis": "~4.1.0", react: "^18.2.0" },
    dsh: {
      bundle: { patch: ["./cordis.patch.yml"] },
      client: { platform: "web", inject: ["@deepseek-ai/dsh-client-locale"] },
    },
  }
}

function localeOf(title, description) {
  return { meta: { title, description } }
}

function iconOf(title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="${PLACEHOLDER_TILE}"/>
  <rect x="16" y="16" width="32" height="32" rx="6" fill="#FFFFFF" fill-opacity="0.95"/>
</svg>
`
}

const HOST_ENTRY = `import type { Context } from "@deepseek-ai/cordis"

export function apply(_ctx: Context): void {}
`

function clientEntry(name) {
  return `import { en, ja } from "./i18n"

export const inject = ["locale"]

export const NAMESPACE = "${name}"

interface ClientContext {
  effect(setup: () => () => void, label?: string): void
  locale: {
    register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "${name}: dictionaries")
}
`
}

const CLIENT_DICTIONARIES = `export const en: Record<string, string> = {}

export const ja: Record<string, string> = {}
`

function patchOf(name, packageName) {
  return `- insert:
    - id: bot-${name}
      name: "${packageName}"
`
}

function bundleRowsOf(document, path) {
  if (document.errors.length > 0) throw new Error(`${path}: ${document.errors[0].message}`)
  if (!isSeq(document.contents)) throw new Error(`${path} is not a list of patch operations`)
  const inserts = document.contents.items.filter(
    (operation) => isMap(operation) && operation.has("insert"),
  )
  if (inserts.length !== 1) {
    throw new Error(`${path} has ${inserts.length} insert operations; expected exactly one`)
  }
  const rows = inserts[0].get("insert")
  if (!isSeq(rows)) throw new Error(`${path}: insert is not a list of rows`)
  return rows
}

function withBundleRow(patch, path, name, packageName) {
  const document = parseDocument(patch)
  const rows = bundleRowsOf(document, path)
  const id = `bot-${name}`
  if (rows.items.some((row) => isMap(row) && row.get("id") === id)) {
    throw new Error(`${path} already inserts ${id}`)
  }
  const quotedName = new Scalar(packageName)
  quotedName.type = Scalar.QUOTE_DOUBLE
  rows.add(document.createNode({ id, name: quotedName }))
  return document.toString()
}

export async function createPlugin(root, name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`invalid plugin name "${name}": use lowercase kebab-case`)
  }
  const directoryName = `dsh-bot-${name}`
  const packageName = `${SCOPE}/${directoryName}`
  const packageDir = join(root, "packages", directoryName)
  const bundleDir = join(root, "packages", BUNDLE_DIRECTORY)
  const bundleManifestPath = join(bundleDir, "package.json")
  const patchPath = join(bundleDir, "cordis.patch.yml")

  if (existsSync(packageDir)) throw new Error(`packages/${directoryName} already exists`)
  const patch = withBundleRow(await readFile(patchPath, "utf8"), patchPath, name, packageName)
  const bundleManifest = JSON.parse(await readFile(bundleManifestPath, "utf8"))
  const title = titleOf(name)

  await mkdir(join(packageDir, "src", "client"), { recursive: true })
  await mkdir(join(packageDir, "locale"), { recursive: true })
  await mkdir(join(packageDir, "test"), { recursive: true })
  await writeFile(
    join(packageDir, "package.json"),
    json(manifestOf(packageName, directoryName, name, bundleManifest)),
  )
  await writeFile(join(packageDir, "src", "index.ts"), HOST_ENTRY)
  await writeFile(join(packageDir, "src", "client", "index.tsx"), clientEntry(name))
  await writeFile(join(packageDir, "src", "client", "i18n.ts"), CLIENT_DICTIONARIES)
  await writeFile(
    join(packageDir, "locale", "en.json"),
    json(localeOf(title, "TODO: describe what the plugin adds, in one or two sentences.")),
  )
  await writeFile(
    join(packageDir, "locale", "ja.json"),
    json(localeOf("TODO: 日本語のタイトル", "TODO: プラグインが加えるものを一、二文で書く。")),
  )
  await writeFile(join(packageDir, "icon.svg"), iconOf(title))
  await copyFile(join(root, "LICENSE"), join(packageDir, "LICENSE"))
  await writeFile(
    join(packageDir, "README.md"),
    `# ${packageName}\n\nTODO: describe what the plugin adds and how to configure it.\n`,
  )
  await writeFile(join(packageDir, "cordis.patch.yml"), patchOf(name, packageName))

  const dependencies = { ...bundleManifest.dependencies, [packageName]: "workspace:*" }
  bundleManifest.dependencies = Object.fromEntries(
    Object.keys(dependencies)
      .sort()
      .map((key) => [key, dependencies[key]]),
  )
  await writeFile(bundleManifestPath, json(bundleManifest))
  await writeFile(patchPath, patch)

  return { directoryName, packageName }
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const requested = process.argv[2]
  if (requested === undefined || requested.length === 0) {
    console.error("usage: pnpm new-plugin <kebab-case-name>")
    process.exit(1)
  }
  try {
    const { directoryName } = await createPlugin(root, requested)
    console.log(`created packages/${directoryName}`)
    console.log(`added the "${requested}" row to packages/${BUNDLE_DIRECTORY}/cordis.patch.yml`)
    console.log(
      "next: write the TODO texts and the icon, then pnpm install && pnpm build && pnpm test",
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
