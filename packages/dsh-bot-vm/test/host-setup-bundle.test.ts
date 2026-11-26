import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  bundleDigestText,
  HOST_SETUP_FILES,
  writeHostSetupBundle,
} from "../../../scripts/host-setup-bundle.mjs"
import {
  readHostSetupBundle,
  bundleDigestText as runtimeDigestText,
} from "../src/host/setup/bundle"

const root = join(import.meta.dirname, "../../..")
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const io = {
  read: (path: string) => readFileSync(path),
  sha256: (content: Uint8Array | string) => createHash("sha256").update(content).digest("hex"),
}

function sourcedBy(file: string): string[] {
  return [
    ...readFileSync(join(root, file), "utf8").matchAll(
      /^\.\s+"\$(?:HERE|\(dirname "\$\{BASH_SOURCE\[0\]\}"\))\/([^"]+)"$/gm,
    ),
  ].map((match) => join(file, "..", match[1] as string))
}

describe("the host setup bundle", () => {
  it("is an exact copy of infra/ with the modes the scripts need", async () => {
    const out = mkdtempSync(join(tmpdir(), "host-setup-bundle-"))
    dirs.push(out)
    const manifest = await writeHostSetupBundle(root, out)
    for (const file of HOST_SETUP_FILES) {
      expect(readFileSync(join(out, file.path))).toEqual(readFileSync(join(root, file.source)))
      expect(statSync(join(out, file.path)).mode & 0o777).toBe(file.mode)
    }
    const bundle = readHostSetupBundle(out, io)
    expect(bundle.sha256).toBe(manifest.sha256)
    expect(bundle.files.map((file) => file.path)).toEqual(HOST_SETUP_FILES.map((file) => file.path))
  })

  it("holds every file host-setup.sh sources, in the same layout", () => {
    const sources = new Set(HOST_SETUP_FILES.map((file) => file.source))
    const pending = ["infra/vm/host-setup.sh"]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const file = pending.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      expect(sources).toContain(file)
      pending.push(...sourcedBy(file))
    }
    expect([...seen].sort()).toEqual([...sources].sort())
    for (const file of HOST_SETUP_FILES) expect(`infra/${file.path}`).toBe(file.source)
  })

  it("is digested the same way by the build and the plugin", async () => {
    const entries = [
      { path: "vm/lib.sh", mode: 0o644, sha256: "1".repeat(64) },
      { path: "release.env", mode: 0o644, sha256: "2".repeat(64) },
      { path: "vm/host-setup.sh", mode: 0o755, sha256: "3".repeat(64) },
    ]
    expect(runtimeDigestText(entries)).toBe(bundleDigestText(entries))
  })

  it("refuses a bundle whose file was changed after the build", async () => {
    const out = mkdtempSync(join(tmpdir(), "host-setup-bundle-"))
    dirs.push(out)
    await writeHostSetupBundle(root, out)
    const changed = {
      ...io,
      read: (path: string) => (path.endsWith("lib.sh") ? Buffer.from("changed") : io.read(path)),
    }
    expect(() => readHostSetupBundle(out, changed)).toThrow(/vm\/lib.sh was changed.*reinstall/)
  })
})
