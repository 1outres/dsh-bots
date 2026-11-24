import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { UPSTREAM_DSH_VERSION, UPSTREAM_FILES } from "../src/client/upstream"

/** The repository's own copy of a DSH package: a root devDependency pinned at UPSTREAM_DSH_VERSION. */
function packageDir(name: string): string {
  return dirname(createRequire(import.meta.url).resolve(`${name}/package.json`))
}

const packages = [...new Set(UPSTREAM_FILES.map((file) => file.package))]
const rootManifest = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string> }

// Re-sync procedure: raise UPSTREAM_DSH_VERSION and these devDependencies
// together, diff each changed upstream file against the bot-core files named
// in `reliedOnBy` (src/client/upstream.ts), port or re-check them, then update
// its sha256.
describe("bot session shell: DSH sources it copies or relies on", () => {
  for (const name of packages) {
    it(`${name} is a root devDependency at UPSTREAM_DSH_VERSION`, () => {
      expect(rootManifest.devDependencies[name]).toBe(UPSTREAM_DSH_VERSION)
      const manifest = JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8")) as {
        version: string
      }
      expect(manifest.version).toBe(UPSTREAM_DSH_VERSION)
    })
  }

  for (const file of UPSTREAM_FILES) {
    it(`${file.package}/${file.path} is unchanged (relied on by ${file.reliedOnBy})`, () => {
      const sha256 = createHash("sha256")
        .update(readFileSync(join(packageDir(file.package), file.path)))
        .digest("hex")
      expect(sha256, `${file.path} changed (${file.reason}): re-check ${file.reliedOnBy}`).toBe(
        file.sha256,
      )
    })
  }
})
