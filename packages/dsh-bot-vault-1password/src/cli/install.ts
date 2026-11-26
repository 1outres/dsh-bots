import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { VaultProviderStatusSource } from "@1outres/dsh-bot-core"
import { type OpArchive, type OpRelease, opArchiveUrl } from "./release"
import type { StatusCell } from "./status"
import { extractZipEntry } from "./zip"

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_BINARY_BYTES = 192 * 1024 * 1024

export interface OpInstallerDeps {
  readonly release: OpRelease
  readonly platform: string
  readonly directory: string
  readonly status: StatusCell
  download(url: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
  readonly signal: AbortSignal
}

export interface OpInstaller {
  readonly status: VaultProviderStatusSource
  binary(signal: AbortSignal): Promise<string>
}

export class OpInstallError extends Error {
  override readonly name = "OpInstallError"
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new OpInstallError(`${path} is not a directory`)
  }
  await chmod(path, 0o700)
}

async function verified(path: string, archive: OpArchive): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(path)
  } catch {
    return false
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BINARY_BYTES) return false
  return sha256(await readFile(path)) === archive.binarySha256
}

const STOPPED_WAITING = "stopped waiting for the 1Password CLI"

const waitFor = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const onAbort = () => reject(new OpInstallError(STOPPED_WAITING))
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })

export function createOpInstaller(deps: OpInstallerDeps): OpInstaller {
  const { release, status } = deps
  const label = `1Password CLI ${release.version}`
  const root = join(deps.directory, "op")
  const versionDirectory = join(root, release.version)
  const binaryPath = join(versionDirectory, "op")
  let ready: string | undefined
  let pending: Promise<string> | undefined

  const removeOtherVersions = async () => {
    for (const name of await readdir(root)) {
      if (name !== release.version) await rm(join(root, name), { recursive: true, force: true })
    }
  }

  const install = async (): Promise<string> => {
    const archive = deps.release.archives[deps.platform]
    if (archive === undefined) {
      throw new OpInstallError(`${label} is not published for ${deps.platform}`)
    }
    status.set({ state: "preparing", step: `Checking the ${label}` })
    await privateDirectory(deps.directory)
    await privateDirectory(root)
    await privateDirectory(versionDirectory)
    if (await verified(binaryPath, archive)) {
      await chmod(binaryPath, 0o700)
      return binaryPath
    }
    status.set({ state: "preparing", step: `Downloading the ${label}` })
    const zip = await deps.download(
      opArchiveUrl(release.version, archive),
      MAX_ARCHIVE_BYTES,
      deps.signal,
    )
    if (sha256(zip) !== archive.sha256) {
      throw new OpInstallError(
        `the downloaded ${label} does not match its pinned SHA-256, so it is not used`,
      )
    }
    status.set({ state: "preparing", step: `Installing the ${label}` })
    const binary = extractZipEntry(zip, "op", MAX_BINARY_BYTES)
    if (sha256(binary) !== archive.binarySha256) {
      throw new OpInstallError(
        "the op in the downloaded " +
          label +
          " does not match its pinned SHA-256, so it is not used",
      )
    }
    const temporary = join(versionDirectory, `.op-${randomUUID()}`)
    try {
      await writeFile(temporary, binary, { flag: "wx", mode: 0o700 })
      await chmod(temporary, 0o700)
      await rename(temporary, binaryPath)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    await removeOtherVersions()
    return binaryPath
  }

  const start = (): Promise<string> => {
    if (pending !== undefined) return pending
    pending = install().then(
      (path) => {
        ready = path
        pending = undefined
        status.set({ state: "ready" })
        return path
      },
      (error: unknown) => {
        pending = undefined
        const reason = `${label} could not be installed: ${messageOf(error)}`
        status.set({ state: "failed", reason })
        throw new OpInstallError(reason)
      },
    )
    pending.catch(() => {})
    return pending
  }

  return {
    status,
    binary(signal) {
      if (ready !== undefined) return Promise.resolve(ready)
      if (signal.aborted) return Promise.reject(new OpInstallError(STOPPED_WAITING))
      return waitFor(start(), signal)
    },
  }
}
