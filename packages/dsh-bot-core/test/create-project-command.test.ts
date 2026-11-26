import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readReleaseEnv } from "../../../scripts/release/release-env.mjs"
import { createProjectCommand } from "../src/client/vm-host/setup-model"

const root = join(import.meta.dirname, "..", "..", "..")

describe("the create-project.sh command of Use an existing server", () => {
  it("is the repository README's for this release", () => {
    const env = readReleaseEnv(root)
    const readme = readFileSync(join(root, "README.md"), "utf8")
    expect(readme).toContain(createProjectCommand(env.DSH_BOTS_VERSION))
  })
})
