import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { VaultProviderStatus } from "@1outres/dsh-bot-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createOpInstaller } from "../src/cli/install"
import { OP_RELEASE, type OpRelease, opArchiveUrl } from "../src/cli/release"
import { createStatusCell } from "../src/cli/status"
import { makeZip } from "./support/zip"

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const binary = new TextEncoder().encode("#!/bin/sh\necho fake op\n")
const zip = makeZip([
  { name: "op", data: binary },
  { name: "op.sig", data: new Uint8Array(8), method: 0 },
])
const archive = {
  os: "linux",
  arch: "amd64",
  sha256: sha256(zip),
  binarySha256: sha256(binary),
} as const
const release: OpRelease = { version: "9.9.9", archives: { "linux-x64": archive } }

let directory: string
beforeEach(() => {
  directory = join(mkdtempSync(join(tmpdir(), "op-install-")), "data")
})
afterEach(() => {
  rmSync(join(directory, ".."), { recursive: true, force: true })
})

function setup(options: { archive?: Uint8Array; platform?: string; release?: OpRelease } = {}) {
  const downloads: string[] = []
  const status = createStatusCell({ state: "preparing" })
  const seen: VaultProviderStatus[] = []
  status.subscribe(() => seen.push(status.read()))
  const installer = createOpInstaller({
    release: options.release ?? release,
    platform: options.platform ?? "linux-x64",
    directory,
    status,
    signal: new AbortController().signal,
    async download(url) {
      downloads.push(url)
      return (options.archive ?? zip).slice()
    },
  })
  return { installer, status, seen, downloads }
}

const binaryPath = () => join(directory, "op", "9.9.9", "op")
const mode = (path: string) => statSync(path).mode & 0o777

describe("the op installer", () => {
  it("downloads, verifies and installs op in private directories", async () => {
    const { installer, status, seen, downloads } = setup()
    expect(await installer.binary(new AbortController().signal)).toBe(binaryPath())
    expect(downloads).toEqual([
      "https://cache.agilebits.com/dist/1P/op2/pkg/v9.9.9/op_linux_amd64_v9.9.9.zip",
    ])
    expect(readFileSync(binaryPath())).toEqual(Buffer.from(binary))
    expect(mode(binaryPath())).toBe(0o700)
    for (const path of [directory, join(directory, "op"), join(directory, "op", "9.9.9")]) {
      expect(mode(path)).toBe(0o700)
    }
    expect(status.read()).toEqual({ state: "ready" })
    expect(seen.map((each) => each.state)).toEqual(["preparing", "preparing", "preparing", "ready"])
  })

  it("uses an installed op that matches without downloading again", async () => {
    await setup().installer.binary(new AbortController().signal)
    const again = setup()
    expect(await again.installer.binary(new AbortController().signal)).toBe(binaryPath())
    expect(again.downloads).toEqual([])
  })

  it("replaces an installed op that does not match", async () => {
    await setup().installer.binary(new AbortController().signal)
    writeFileSync(binaryPath(), "tampered")
    const again = setup()
    await again.installer.binary(new AbortController().signal)
    expect(again.downloads).toHaveLength(1)
    expect(readFileSync(binaryPath())).toEqual(Buffer.from(binary))
  })

  it("uses nothing when the archive does not match its pinned hash", async () => {
    const { installer, status } = setup({
      archive: makeZip([
        { name: "op", data: binary },
        { name: "x", data: binary },
      ]),
    })
    await expect(installer.binary(new AbortController().signal)).rejects.toThrow(
      /does not match its pinned SHA-256/,
    )
    expect(status.read()).toMatchObject({ state: "failed" })
    expect(existsSync(binaryPath())).toBe(false)
  })

  it("uses nothing when the op inside does not match its pinned hash", async () => {
    const other = makeZip([{ name: "op", data: new TextEncoder().encode("evil") }])
    const pinned: OpRelease = {
      version: "9.9.9",
      archives: { "linux-x64": { ...archive, sha256: sha256(other) } },
    }
    const { installer } = setup({ archive: other, release: pinned })
    await expect(installer.binary(new AbortController().signal)).rejects.toThrow(
      /op in the downloaded .* does not match/,
    )
    expect(existsSync(binaryPath())).toBe(false)
  })

  it("fails on a platform 1Password publishes no CLI for", async () => {
    const { installer, status, downloads } = setup({ platform: "win32-x64" })
    await expect(installer.binary(new AbortController().signal)).rejects.toThrow(
      /not published for win32-x64/,
    )
    expect(status.read()).toMatchObject({ state: "failed" })
    expect(downloads).toEqual([])
  })

  it("tries again after a failure", async () => {
    let fail = true
    const status = createStatusCell({ state: "preparing" })
    const installer = createOpInstaller({
      release,
      platform: "linux-x64",
      directory,
      status,
      signal: new AbortController().signal,
      async download() {
        if (fail) throw new Error("offline")
        return zip.slice()
      },
    })
    await expect(installer.binary(new AbortController().signal)).rejects.toThrow(/offline/)
    fail = false
    expect(await installer.binary(new AbortController().signal)).toBe(binaryPath())
    expect(status.read()).toEqual({ state: "ready" })
  })

  it("refuses a symbolic link or file in place of its directories", async () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, "op"), "not a directory")
    await expect(setup().installer.binary(new AbortController().signal)).rejects.toThrow()
  })

  it("removes other versions once installed", async () => {
    mkdirSync(join(directory, "op", "1.0.0"), { recursive: true })
    await setup().installer.binary(new AbortController().signal)
    expect(existsSync(join(directory, "op", "1.0.0"))).toBe(false)
  })

  it("stops waiting when the caller's signal aborts", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(setup().installer.binary(controller.signal)).rejects.toThrow(/stopped waiting/)
  })
})

describe("the pinned release", () => {
  it("pins 2.42.0 for Linux and macOS on amd64 and arm64", () => {
    expect(OP_RELEASE.version).toBe("2.42.0")
    expect(Object.keys(OP_RELEASE.archives).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
    ])
    for (const archive of Object.values(OP_RELEASE.archives)) {
      expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(archive.binarySha256).toMatch(/^[0-9a-f]{64}$/)
      expect(opArchiveUrl(OP_RELEASE.version, archive)).toBe(
        "https://cache.agilebits.com/dist/1P/op2/pkg/v2.42.0/op_" +
          archive.os +
          "_" +
          archive.arch +
          "_v2.42.0.zip",
      )
    }
  })
})
