import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readBrowserInstallation } from "@1outres/dsh-bot-connector-browser"
import { readVmSources } from "@1outres/dsh-bot-connector-desktop"
import { afterAll, describe, expect, it } from "vitest"
import { unpack, unpackedPaths } from "./support/pack"
import { readManifest } from "./support/packages"

/**
 * What a package publishes is what `pnpm pack` puts into its tarball, which
 * leaves out some names wherever they are (package-lock.json among them).
 */

const root = fileURLToPath(new URL("..", import.meta.url))
const packageDirectories = readdirSync(join(root, "packages")).sort()
const packages = (name: string) => join(root, "packages", name)

describe.each(packageDirectories)("%s's tarball", (directoryName) => {
  it("has every tracked file its files field names", () => {
    const directory = packages(directoryName)
    expect(unpackedPaths(directory, readManifest(directory))).toEqual([])
  })
})

describe("the files a connector reads from its package at run time", () => {
  const destination = mkdtempSync(join(tmpdir(), "dsh-bots-pack-"))
  afterAll(() => rmSync(destination, { recursive: true, force: true }))

  it("are in the browser connector's tarball", async () => {
    const unpacked = unpack(packages("dsh-bot-connector-browser"), join(destination, "browser"))
    const vm = new URL("vm/", pathToFileURL(`${unpacked}/`))
    expect(await readBrowserInstallation(vm)).toEqual(await readBrowserInstallation())
  })

  it("are in the desktop connector's tarball", async () => {
    const unpacked = unpack(packages("dsh-bot-connector-desktop"), join(destination, "desktop"))
    expect(await readVmSources(join(unpacked, "vm"))).toEqual(await readVmSources())
  })
})
