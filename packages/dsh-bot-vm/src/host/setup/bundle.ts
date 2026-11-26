import type { BundleFile, HostSetupBundle } from "./shell"

export const BUNDLE_MANIFEST = "bundle.json"

export interface BundleEntry {
  readonly path: string
  readonly mode: number
  readonly sha256: string
}

export interface BundleIo {
  read(path: string): Uint8Array
  sha256(content: Uint8Array | string): string
}

const PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/
const SHA256 = /^[0-9a-f]{64}$/

export function bundleDigestText(entries: readonly BundleEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.mode.toString(8).padStart(4, "0")} ${entry.sha256} ${entry.path}\n`)
    .join("")
}

function entriesOf(manifest: unknown): { readonly sha256: string; readonly files: BundleEntry[] } {
  if (typeof manifest !== "object" || manifest === null)
    throw new Error("the manifest is not an object")
  const { version, sha256, files } = manifest as Record<string, unknown>
  if (version !== 1) throw new Error("the manifest has an unknown version")
  if (typeof sha256 !== "string" || !SHA256.test(sha256))
    throw new Error("the manifest names no sha256")
  if (!Array.isArray(files) || files.length === 0) throw new Error("the manifest lists no files")
  return {
    sha256,
    files: files.map((file: unknown) => {
      const { path, mode, sha256: digest } = (file ?? {}) as Record<string, unknown>
      if (typeof path !== "string" || !PATH.test(path))
        throw new Error("the manifest lists a bad path")
      if (mode !== 0o644 && mode !== 0o755) throw new Error(`the manifest gives ${path} a bad mode`)
      if (typeof digest !== "string" || !SHA256.test(digest))
        throw new Error(`the manifest gives ${path} no sha256`)
      return { path, mode, sha256: digest }
    }),
  }
}

export function readHostSetupBundle(dir: string, io: BundleIo): HostSetupBundle {
  const where = `the host setup bundle ${dir}`
  try {
    const manifest = entriesOf(
      JSON.parse(new TextDecoder().decode(io.read(`${dir}/${BUNDLE_MANIFEST}`))),
    )
    if (io.sha256(bundleDigestText(manifest.files)) !== manifest.sha256) {
      throw new Error("its sha256 does not match its files")
    }
    const files: BundleFile[] = manifest.files.map((entry) => {
      const content = io.read(`${dir}/${entry.path}`)
      if (io.sha256(content) !== entry.sha256) throw new Error(`${entry.path} was changed`)
      return { ...entry, content }
    })
    return { sha256: manifest.sha256, files }
  } catch (error) {
    throw new Error(
      `${where} is unusable (${error instanceof Error ? error.message : String(error)}); reinstall @1outres/dsh-bot-vm`,
    )
  }
}
