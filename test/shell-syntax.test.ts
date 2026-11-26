import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..")

describe("infra shell scripts", () => {
  it("parse with bash", () => {
    const scripts = ["infra/vm", "infra/incus"].flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((file) => file.endsWith(".sh"))
        .map((file) => join(root, dir, file)),
    )
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(() => execFileSync("bash", ["-n", script])).not.toThrow()
  })
})
