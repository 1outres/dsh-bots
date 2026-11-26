import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("the agent's type_secret", () => {
  it("passes its Python tests", () => {
    const script = fileURLToPath(new URL("./agent/test_secret_input.py", import.meta.url))
    const agent = fileURLToPath(new URL("../vm/agent", import.meta.url))
    const run = spawnSync("python3", ["-I", "-B", script, agent], { encoding: "utf8" })
    expect(run.error).toBeUndefined()
    expect(run.status, run.stderr).toBe(0)
  })
})
