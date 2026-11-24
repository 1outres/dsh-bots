import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { UPSTREAM_DSH_VERSION } from "../src/client/upstream"

interface Manifest {
  readonly name: string
  readonly engines?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

const root = fileURLToPath(new URL("../../..", import.meta.url))
const read = (directory: string) =>
  JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Manifest
const inside = (parent: string) =>
  readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, parent, entry.name))
    .filter((directory) => existsSync(join(directory, "package.json")))

const packages = inside("packages").map(read)
const devBundles = inside("dev")
  .map(read)
  .filter((manifest) => manifest.engines !== undefined)
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "devDependencies"] as const

describe("the DSH version bot-core was verified against (UPSTREAM_DSH_VERSION)", () => {
  it("is every package's engines.dsh", () => {
    const required = [...packages, ...devBundles].map((manifest) => [
      manifest.name,
      manifest.engines?.dsh,
    ])
    expect(required).toEqual(
      [...packages, ...devBundles].map((m) => [m.name, UPSTREAM_DSH_VERSION]),
    )
  })

  it("is the exact version of every DSH package any manifest names", () => {
    const unverified = [read(root), ...packages, ...devBundles].flatMap((manifest) =>
      DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
          .filter(
            ([name, range]) =>
              name.startsWith("@deepseek-ai/dsh") && range !== UPSTREAM_DSH_VERSION,
          )
          .map(([name, range]) => `${manifest.name} ${field} ${name}@${range}`),
      ),
    )
    expect(unverified).toEqual([])
  })
})
