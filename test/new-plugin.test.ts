import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import { createPlugin, titleOf } from "../scripts/new-plugin.mjs"
import {
  BUNDLE_DIRECTORY,
  clientDictionaryProblems,
  commonManifestProblems,
  displayResourceProblems,
  displayTextProblems,
  pluginManifestProblems,
  readManifest,
} from "./support/packages"

const repository = fileURLToPath(new URL("..", import.meta.url))

describe("titleOf", () => {
  it("writes a sentence-case title", () => {
    expect(titleOf("mode-memory")).toBe("Mode memory")
    expect(titleOf("notify")).toBe("Notify")
  })
})

describe("createPlugin", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "new-plugin-"))
    cpSync(join(repository, "LICENSE"), join(root, "LICENSE"))
    for (const file of ["package.json", "cordis.patch.yml"]) {
      cpSync(
        join(repository, "packages", BUNDLE_DIRECTORY, file),
        join(root, "packages", BUNDLE_DIRECTORY, file),
      )
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("creates a package that follows the repository conventions", async () => {
    const { directoryName } = await createPlugin(root, "my-thing")
    const directory = join(root, "packages", directoryName)
    const bundle = readManifest(join(root, "packages", BUNDLE_DIRECTORY))

    expect(commonManifestProblems(directory, directoryName, bundle)).toEqual([])
    expect(pluginManifestProblems(directory, directoryName)).toEqual([])
    expect(displayResourceProblems(directory)).toEqual([])
    expect(await clientDictionaryProblems(directory)).toEqual([])
  })

  it("leaves placeholder text that the repository test rejects", async () => {
    const { directoryName } = await createPlugin(root, "my-thing")

    expect(displayTextProblems(join(root, "packages", directoryName))).not.toEqual([])
  })

  it("adds the package to the bundle dependencies and patch", async () => {
    const bundleDir = join(root, "packages", BUNDLE_DIRECTORY)
    const patchPath = join(bundleDir, "cordis.patch.yml")
    const before = readFileSync(patchPath, "utf8")
    await createPlugin(root, "my-thing")
    const after = readFileSync(patchPath, "utf8")

    expect(readManifest(bundleDir).dependencies?.["@1outres/dsh-bot-my-thing"]).toBe("workspace:*")
    expect(after).toBe(`${before}    - id: bot-my-thing\n      name: "@1outres/dsh-bot-my-thing"\n`)
    expect(parse(after)).toEqual([
      {
        insert: [
          ...parse(before)[0].insert,
          { id: "bot-my-thing", name: "@1outres/dsh-bot-my-thing" },
        ],
      },
    ])
  })

  it("refuses a bundle patch without exactly one insert operation", async () => {
    const patchPath = join(root, "packages", BUNDLE_DIRECTORY, "cordis.patch.yml")
    writeFileSync(patchPath, "- remove: bot-old\n")

    await expect(createPlugin(root, "my-thing")).rejects.toThrow("0 insert operations")
    expect(existsSync(join(root, "packages", "dsh-bot-my-thing"))).toBe(false)
  })

  it("refuses a plugin the bundle patch already inserts", async () => {
    const patchPath = join(root, "packages", BUNDLE_DIRECTORY, "cordis.patch.yml")
    writeFileSync(
      patchPath,
      '- insert:\n    - id: bot-my-thing\n      name: "@1outres/dsh-bot-my-thing"\n',
    )

    await expect(createPlugin(root, "my-thing")).rejects.toThrow("already inserts bot-my-thing")
  })

  it("refuses a name that is not kebab-case", async () => {
    await expect(createPlugin(root, "My_Thing")).rejects.toThrow("kebab-case")
  })
})
