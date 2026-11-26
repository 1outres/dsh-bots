import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { packedManifestProblems, packedProblems } from "../scripts/release/packed.mjs"
import { publishReport, registryStates } from "../scripts/release/registry.mjs"
import { parseReleaseEnv, readReleaseEnv } from "../scripts/release/release-env.mjs"
import { versionProblems } from "../scripts/release/versions.mjs"
import { workspaceManifests } from "../scripts/release/workspace.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = (version: string) => ({
  DSH_BOTS_VERSION: version,
  DSH_VERSION: "0.2.2-rc.5",
  IMAGE_TAG: "",
  IMAGE_MANIFEST_SHA256: "",
})

describe("parseReleaseEnv", () => {
  it("reads KEY=value lines and skips comments", () => {
    const text =
      "# c\nDSH_BOTS_VERSION=1.2.3\nDSH_VERSION=0.2.2-rc.5\nIMAGE_TAG=\nIMAGE_MANIFEST_SHA256=\n"
    expect(parseReleaseEnv(text)).toEqual(env("1.2.3"))
  })

  it("refuses a value bash would read differently", () => {
    expect(() => parseReleaseEnv('DSH_BOTS_VERSION="1.2.3"\n')).toThrow(/line 1/)
  })

  it("refuses a file without every key", () => {
    expect(() => parseReleaseEnv("DSH_BOTS_VERSION=1.2.3\n")).toThrow(/lacks DSH_VERSION/)
  })
})

describe("versionProblems", () => {
  const manifests = [
    { path: "packages/a/package.json", manifest: { name: "@1outres/a", version: "1.2.3" } },
    { path: "packages/b/package.json", manifest: { name: "@1outres/b", version: "1.2.2" } },
  ]

  it("names the tag and every package that differ from release.env", () => {
    const problems = versionProblems("v1.2.4", env("1.2.3"), manifests)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^The tag is v1\.2\.4, but .* DSH_BOTS_VERSION=1\.2\.3/)
    expect(problems[1]).toMatch(/^packages\/b\/package\.json has version 1\.2\.2/)
  })

  it("accepts this tree for its own version", () => {
    const releaseEnv = readReleaseEnv(root)
    const tag = `v${releaseEnv.DSH_BOTS_VERSION}`
    expect(versionProblems(tag, releaseEnv, workspaceManifests(root))).toEqual([])
  })
})

describe("packedManifestProblems", () => {
  it("accepts exact dependencies and caret peers of the release version", () => {
    const manifest = {
      name: "@1outres/x",
      version: "1.2.3",
      dependencies: { "@1outres/a": "1.2.3", zod: "4.4.3" },
      peerDependencies: { "@1outres/core": "^1.2.3" },
      devDependencies: { "@1outres/core": "1.2.3" },
    }
    expect(packedManifestProblems(manifest, "1.2.3")).toEqual([])
  })

  it("names a workspace range left in the tarball and a range of another version", () => {
    const manifest = {
      name: "@1outres/x",
      version: "1.2.3",
      dependencies: { "@1outres/a": "workspace:*" },
      peerDependencies: { "@1outres/core": "^1.2.0" },
    }
    expect(packedManifestProblems(manifest, "1.2.3")).toEqual([
      "@1outres/x: dependencies.@1outres/a is still workspace:* in the tarball",
      "@1outres/x: peerDependencies.@1outres/core is ^1.2.0, not ^1.2.3",
    ])
  })
})

describe("the workspace's tarballs", () => {
  it("name the release version for every @1outres dependency", () => {
    expect(packedProblems(root, readReleaseEnv(root).DSH_BOTS_VERSION)).toEqual([])
  }, 120_000)
})

describe("the report after a failed publish", () => {
  const manifests = [
    { path: "packages/a/package.json", manifest: { name: "@1outres/a", version: "1.0.1" } },
    { path: "packages/b/package.json", manifest: { name: "@1outres/b", version: "1.0.1" } },
    { path: "packages/c/package.json", manifest: { name: "@1outres/c", version: "1.0.1" } },
  ]
  const packuments: Record<string, { versions: Record<string, unknown> } | null> = {
    "@1outres/a": { versions: { "1.0.0": {}, "1.0.1": {} } },
    "@1outres/b": { versions: { "1.0.0": {} } },
    "@1outres/c": null,
  }

  it("names what npm serves and what it does not", async () => {
    const states = await registryStates(manifests, async (name) => packuments[name] ?? null)
    expect(states.map((state) => state.served)).toEqual([true, false, false])
    const report = publishReport(states)
    expect(report.lines).toEqual([
      "- @1outres/a@1.0.1: on npm",
      "- @1outres/b@1.0.1: not on npm",
      "- @1outres/c@1.0.1: not on npm",
    ])
    expect(report.advice.join(" ")).toContain("@1outres/b@1.0.1")
    expect(report.advice.join(" ")).toContain("Staged Packages")
  })

  it("has no advice once npm serves every package", async () => {
    const states = await registryStates(
      manifests.slice(0, 1),
      async (name) => packuments[name] ?? null,
    )
    expect(publishReport(states).advice).toEqual([])
  })
})
