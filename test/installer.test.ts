import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readReleaseEnv } from "../scripts/release/release-env.mjs"

const root = join(import.meta.dirname, "..")
const manifest = (name: string) =>
  JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")) as {
    version: string
    engines: { dsh: string }
  }

const releaseEnv = () => readReleaseEnv(root)

describe("installer release", () => {
  it("installs the bundle's version for the DSH version it requires", () => {
    const env = releaseEnv()
    const bundle = manifest("dsh-bots")
    expect(env.DSH_BOTS_VERSION).toBe(bundle.version)
    expect(env.DSH_VERSION).toBe(bundle.engines.dsh)
  })

  it("names in the README the plugin version and DSH version this tree installs", () => {
    const env = releaseEnv()
    const readme = readFileSync(join(root, "README.md"), "utf8")
    expect(readme).toContain(`@1outres/dsh-bots@${env.DSH_BOTS_VERSION}`)
    expect(readme).toContain(`DeepSeek Harness ${env.DSH_VERSION}`)
  })

  it("names a base image tag and manifest hash together or neither", () => {
    const env = releaseEnv()
    expect(env.IMAGE_TAG === "").toBe(env.IMAGE_MANIFEST_SHA256 === "")
    if (env.IMAGE_MANIFEST_SHA256 !== "")
      expect(env.IMAGE_MANIFEST_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("has shell scripts bash can parse", () => {
    const scripts = [
      join(root, "install.sh"),
      ...["infra/vm", "infra/incus"].flatMap((dir) =>
        readdirSync(join(root, dir))
          .filter((file) => file.endsWith(".sh"))
          .map((file) => join(root, dir, file)),
      ),
    ]
    for (const script of scripts) expect(() => execFileSync("bash", ["-n", script])).not.toThrow()
  })
})
