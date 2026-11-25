import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { HELPER_DIR, MCP_DIR } from "../src/host/vm/layout"
import { readBrowserInstallation } from "../src/index"

const INFRA = fileURLToPath(new URL("../../../infra/vm/", import.meta.url))
const build = readFileSync(`${INFRA}build-base-image.sh`, "utf8")
const provision = readFileSync(`${INFRA}provision-base.sh`, "utf8")

describe("the base image", () => {
  it("installs Playwright MCP from this package's shrinkwrap with this package's script, where the preparation looks", () => {
    expect(build).toContain("BROWSER_VM=$HERE/../../packages/dsh-bot-connector-browser/vm\n")
    expect(build).toContain(`BROWSER_MCP_DIR=${MCP_DIR}\n`)
    for (const file of ["mcp/package.json", "mcp/npm-shrinkwrap.json", "install-mcp.sh"]) {
      const name = file.split("/").at(-1)
      expect(build).toContain(`push 0644 "$BROWSER_VM/${file}" "$BROWSER_MCP_STAGE/${name}"\n`)
    }
    expect(build).toContain(
      'printf \'BROWSER_MCP_STAGE="%s"\\nBROWSER_MCP_DIR="%s"\\n\' "$BROWSER_MCP_STAGE" "$BROWSER_MCP_DIR"',
    )
    expect(provision).toContain(
      'sh "$BROWSER_MCP_STAGE/install-mcp.sh" "$BROWSER_MCP_STAGE" "$BROWSER_MCP_DIR"\n',
    )
  })

  it("installs every login helper with this package's script, where the tools run them", async () => {
    expect(build).toContain(`BROWSER_HELPER_DIR=${HELPER_DIR}\n`)
    expect(build).toContain(
      'for helper in "$BROWSER_VM"/helper/*.mjs; do push 0644 "$helper" "$BROWSER_HELPER_STAGE/$(basename "$helper")"; done\n',
    )
    expect(build).toContain(
      'push 0644 "$BROWSER_VM/install-helper.sh" "$BROWSER_HELPER_STAGE/install-helper.sh"\n',
    )
    expect(build).toContain(
      'printf \'BROWSER_HELPER_STAGE="%s"\\nBROWSER_HELPER_DIR="%s"\\n\' "$BROWSER_HELPER_STAGE" "$BROWSER_HELPER_DIR"',
    )
    expect(provision).toContain(
      'sh "$BROWSER_HELPER_STAGE/install-helper.sh" "$BROWSER_HELPER_STAGE" "$BROWSER_HELPER_DIR"\n',
    )
    const names = (await readBrowserInstallation()).helper.files.map((file) => file.name)
    expect(names).toEqual(
      expect.arrayContaining(["dsh-browser-fill.mjs", "dsh-browser-passkey.mjs", "cdp.mjs"]),
    )
  })
})
