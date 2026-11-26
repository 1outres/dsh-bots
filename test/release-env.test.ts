import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readReleaseEnv } from "../scripts/release/release-env.mjs"

const root = join(import.meta.dirname, "..")
const manifest = (name: string) =>
  JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")) as {
    version: string
    engines: { dsh: string }
  }
const readme = () => readFileSync(join(root, "README.md"), "utf8")

describe("infra/release.env", () => {
  it("names the bundle's version and the DSH version it requires", () => {
    const env = readReleaseEnv(root)
    const bundle = manifest("dsh-bots")
    expect(env.DSH_BOTS_VERSION).toBe(bundle.version)
    expect(env.DSH_VERSION).toBe(bundle.engines.dsh)
  })

  it("names a base image tag and manifest hash together or neither", () => {
    const env = readReleaseEnv(root)
    expect(env.IMAGE_TAG === "").toBe(env.IMAGE_MANIFEST_SHA256 === "")
    if (env.IMAGE_MANIFEST_SHA256 !== "")
      expect(env.IMAGE_MANIFEST_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("README", () => {
  it("names the plugin version and DSH version of this tree", () => {
    const env = readReleaseEnv(root)
    expect(readme()).toContain(`@1outres/dsh-bots@${env.DSH_BOTS_VERSION}`)
    expect(readme()).toContain(`DeepSeek Harness ${env.DSH_VERSION}`)
  })
})
