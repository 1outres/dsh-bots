import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { placementOf } from "../src/host/vm/files"
import { DESKTOP_PACKAGES, parsePackageList } from "../src/host/vm/packages"

const LIST = fileURLToPath(new URL("../debian-packages.txt", import.meta.url))
const INFRA = fileURLToPath(new URL("../../../infra/vm/", import.meta.url))
const build = readFileSync(`${INFRA}build-base-image.sh`, "utf8")
const provision = readFileSync(`${INFRA}provision-base.sh`, "utf8")

function lineOf(script: string, start: string): string {
  const lines = script.split("\n").filter((line) => line.startsWith(start))
  if (lines.length !== 1) throw new Error(`expected one line starting with ${start}`)
  return lines[0] as string
}

describe("the package list", () => {
  it("is the connector's debian-packages.txt", () => {
    expect(DESKTOP_PACKAGES).toEqual(parsePackageList(readFileSync(LIST, "utf8")))
    expect(DESKTOP_PACKAGES).toContain("google-chrome-stable")
    expect(DESKTOP_PACKAGES).not.toContain("chromium")
  })

  it("is one package name per line, each once", () => {
    expect(parsePackageList("xclip\nsocat\n")).toEqual(["xclip", "socat"])
    for (const text of ["", "xclip", "xclip\n\n", "# x\nxclip\n", " xclip\n", "xclip\nxclip\n"]) {
      expect(() => parsePackageList(text)).toThrow()
    }
  })
})

describe("the base image", () => {
  it("installs the same list as the preparation", () => {
    const file = lineOf(build, "DESKTOP_PACKAGES_FILE=").replace("$HERE/", INFRA)
    const script = [
      "set -euo pipefail",
      file,
      lineOf(build, "desktop_packages="),
      'DESKTOP_PACKAGES="$desktop_packages"',
      lineOf(provision, "read -ra desktop_packages"),
      `printf "%s\\n" "\${desktop_packages[@]}"`,
    ].join("\n")
    const installed = execFileSync("bash", ["-c", script], { encoding: "utf8" })
    expect(parsePackageList(installed)).toEqual(DESKTOP_PACKAGES)
    expect(build).toContain(`printf 'DESKTOP_PACKAGES="%s"\\n' "$desktop_packages"`)
    expect(provision).toContain(
      `apt-get install -y -q --no-install-recommends "\${desktop_packages[@]}"`,
    )
  })

  it("has Google's Chrome source where the preparation puts it, before the packages", () => {
    for (const source of ["apt/google-chrome.asc", "apt/google-chrome.sources"]) {
      const { target } = placementOf(source)
      expect(build).toContain(`push 0644 "$DESKTOP_VM/${source}" ${target}
`)
    }
    expect(build.indexOf('push 0644 "$DESKTOP_VM/')).toBeLessThan(
      build.indexOf('log "Provisioning"'),
    )
    expect(lineOf(build, "DESKTOP_VM=")).toBe(
      "DESKTOP_VM=$HERE/../../packages/dsh-bot-connector-desktop/vm",
    )
  })
})
