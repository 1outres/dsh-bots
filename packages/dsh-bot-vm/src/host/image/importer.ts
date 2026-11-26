/**
 * Importing a base image release into the Incus project
 * (docs/specs/incus-endpoint.md §5.5), as strict as install.sh's image step:
 * the manifest's sha256 is the release's, every part has its size and sha256,
 * the joined image has the manifest's sha256 and Incus computes that same
 * fingerprint; only then does the alias move.
 *
 * Under `dir`: `manifests/<manifest sha256>.txt` (verified, kept while it is
 * the release's) and `downloads/<manifest sha256>/` (parts, `<part>.partial`
 * while one is downloaded; removed once the alias points at the image).
 */
import type {
  BotEnvironmentImageRelease,
  ImageImportStep,
  ImageProblem,
  ImageProblemCode,
} from "@1outres/dsh-bot-core"
import type { IncusClient } from "../incus"
import type { Hasher, ImageFiles, ImageHttp } from "./io"
import { type ImageManifest, type ImagePart, MANIFEST_FILE, parseManifest } from "./manifest"

export interface ImporterDeps {
  readonly incus: IncusClient
  readonly files: ImageFiles
  readonly http: ImageHttp
  readonly sha256: () => Hasher
  /** Absolute directory of the manifests and downloads. */
  readonly dir: string
  /** The DSH version the plugin runs on, which the image must be built for. */
  readonly dshVersion: string
  /** Deadline of sending the image to Incus. */
  readonly uploadTimeoutMs: number
  readonly log: (message: string) => void
}

export class ImageStepError extends Error {
  constructor(
    readonly step: ImageImportStep | "check",
    readonly problem: ImageProblem,
  ) {
    super(`${problem.message} (${problem.fix})`)
    this.name = "ImageStepError"
  }
}

export type ProgressSink = (step: ImageImportStep, doneBytes: number, totalBytes: number) => void

export interface Importer {
  /** The release's manifest: the kept one, or downloaded and verified. */
  manifest(release: BotEnvironmentImageRelease, signal?: AbortSignal): Promise<ImageManifest>
  /** The fingerprint the alias points at, or undefined. */
  target(alias: string, signal?: AbortSignal): Promise<string | undefined>
  /** Make the alias point at the release's image, downloading and uploading what is missing. */
  run(
    release: BotEnvironmentImageRelease,
    manifest: ImageManifest,
    alias: string,
    progress: ProgressSink,
    signal?: AbortSignal,
  ): Promise<void>
  /** Remove every download (the alias points at the release's image). */
  clearDownloads(): Promise<void>
}

const MANIFEST_MAX_BYTES = 64 * 1024
const GIB = 1024 ** 3
const RETRY_FIX = "check the network, then import again; it continues the download"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const gib = (bytes: number) => `${(bytes / GIB).toFixed(2)} GiB`

export function createImporter(deps: ImporterDeps): Importer {
  const { incus, files, http } = deps
  const manifestsDir = `${deps.dir}/manifests`
  const downloadsDir = `${deps.dir}/downloads`

  const problem = (
    step: ImageImportStep | "check",
    code: ImageProblemCode,
    message: string,
    fix: string,
  ) => new ImageStepError(step, { code, message, fix })

  /** Incus failures keep their message; aborts stay aborts. */
  async function incusStep<T>(
    step: ImageImportStep | "check",
    what: string,
    signal: AbortSignal | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (signal?.aborted || error instanceof ImageStepError) throw error
      throw problem(
        step,
        "incus",
        `Incus could not ${what}: ${messageOf(error)}`,
        "check the VM host's connection and the project's settings",
      )
    }
  }

  async function readSmall(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await http.get(url, 0, signal)
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.length
      if (length > MANIFEST_MAX_BYTES)
        throw new Error(`it is larger than ${MANIFEST_MAX_BYTES} bytes`)
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.length
    }
    return bytes
  }

  function checkedManifest(text: string, release: BotEnvironmentImageRelease): ImageManifest {
    const reading = parseManifest(text)
    if (!reading.ok) {
      throw problem(
        "manifest",
        "manifest-invalid",
        `the manifest of ${release.tag} cannot be read: ${reading.reason}`,
        "use the dsh-bots version that release was made for",
      )
    }
    if (reading.manifest.dsh !== deps.dshVersion) {
      throw problem(
        "manifest",
        "manifest-dsh-version",
        `the base image of ${release.tag} is for DSH ${reading.manifest.dsh}, this plugin runs on DSH ${deps.dshVersion}`,
        "use the dsh-bots version made for this DSH",
      )
    }
    return reading.manifest
  }

  const digestOf = (bytes: Uint8Array) => {
    const hasher = deps.sha256()
    hasher.update(bytes)
    return hasher.digest()
  }

  async function manifest(release: BotEnvironmentImageRelease, signal?: AbortSignal) {
    const kept = `${manifestsDir}/${release.manifestSha256}.txt`
    const text = await files.readText(kept)
    if (text !== undefined && digestOf(new TextEncoder().encode(text)) === release.manifestSha256) {
      return checkedManifest(text, release)
    }
    const url = `${release.baseUrl}/${MANIFEST_FILE}`
    let bytes: Uint8Array
    try {
      bytes = await readSmall(url, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      throw problem(
        "manifest",
        "manifest-unreachable",
        `downloading ${url} failed: ${messageOf(error)}`,
        "check the network, then try again",
      )
    }
    const actual = digestOf(bytes)
    if (actual !== release.manifestSha256) {
      throw problem(
        "manifest",
        "manifest-mismatch",
        `${url} has sha256 ${actual}, this plugin names ${release.manifestSha256}`,
        "try again; if it persists, report it (the release does not match this plugin)",
      )
    }
    const downloaded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const parsed = checkedManifest(downloaded, release)
    await files.mkdir(manifestsDir)
    for (const name of await files.list(manifestsDir)) {
      if (name !== `${release.manifestSha256}.txt`) await files.remove(`${manifestsDir}/${name}`)
    }
    await files.writeText(kept, downloaded)
    return parsed
  }

  interface PartPaths {
    readonly done: string
    readonly partial: string
  }

  async function bytesNeeded(manifestParts: readonly ImagePart[], dir: string): Promise<number> {
    let needed = 0
    for (const part of manifestParts) {
      if ((await files.size(`${dir}/${part.name}`)) === part.bytes) continue
      const partial = (await files.size(`${dir}/${part.name}.partial`)) ?? 0
      needed += part.bytes - Math.min(partial, part.bytes)
    }
    return needed
  }

  /** Feed a file to the hashers; resolves with its byte count. */
  async function hashFile(
    path: string,
    hashers: readonly Hasher[],
    onBytes: (bytes: number) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    let length = 0
    for await (const chunk of files.read(path, signal)) {
      for (const hasher of hashers) hasher.update(chunk)
      length += chunk.length
      onBytes(length)
    }
    return length
  }

  /**
   * Make `paths.done` the part, continuing `paths.partial`; every byte of
   * the part goes, in order, to `whole` (replaced when the part restarts).
   */
  async function downloadPart(
    url: string,
    part: ImagePart,
    paths: PartPaths,
    whole: { hasher: Hasher },
    onBytes: (bytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const before = whole.hasher.copy()
    let have = (await files.size(paths.partial)) ?? 0
    if (have > part.bytes) {
      await files.remove(paths.partial)
      have = 0
    }
    let hasher = deps.sha256()
    if (have > 0) await hashFile(paths.partial, [hasher, whole.hasher], onBytes, signal)
    if (have === part.bytes) return finishPart(part, paths, hasher)
    let response: Awaited<ReturnType<ImageHttp["get"]>>
    try {
      response = await http.get(url, have, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      throw problem(
        "download",
        "part-unreachable",
        `downloading ${url} failed: ${messageOf(error)}`,
        RETRY_FIX,
      )
    }
    let truncate = false
    if (response.kind === "whole") {
      if (response.total !== undefined && response.total !== part.bytes) {
        throw problem(
          "download",
          "part-mismatch",
          `${url} has ${response.total} bytes, the manifest names ${part.bytes}`,
          "try again; if it persists, report it",
        )
      }
      if (have > 0) {
        deps.log(`${url} was sent from its start; downloading ${part.name} anew`)
        hasher = deps.sha256()
        whole.hasher = before.copy()
        have = 0
        onBytes(0)
      }
      truncate = true
    } else if (response.start !== have || response.total !== part.bytes) {
      throw problem(
        "download",
        "part-unreachable",
        `${url} sent bytes from ${response.start} of ${response.total}, not from ${have} of ${part.bytes}`,
        RETRY_FIX,
      )
    }
    const out = await files.append(paths.partial, truncate)
    try {
      for await (const chunk of response.body) {
        if (have + chunk.length > part.bytes) {
          throw problem(
            "download",
            "part-mismatch",
            `${url} has more than the ${part.bytes} bytes the manifest names`,
            "try again; if it persists, report it",
          )
        }
        await out.write(chunk)
        hasher.update(chunk)
        whole.hasher.update(chunk)
        have += chunk.length
        onBytes(have)
      }
    } catch (error) {
      if (signal?.aborted || error instanceof ImageStepError) throw error
      throw problem(
        "download",
        "part-unreachable",
        `downloading ${url} stopped after ${have} of ${part.bytes} bytes: ${messageOf(error)}`,
        RETRY_FIX,
      )
    } finally {
      await out.close()
    }
    if (have !== part.bytes) {
      throw problem(
        "download",
        "part-unreachable",
        `${url} ended after ${have} of ${part.bytes} bytes`,
        RETRY_FIX,
      )
    }
    return finishPart(part, paths, hasher)
  }

  /** Keep a downloaded part only when it has the manifest's sha256. */
  async function finishPart(part: ImagePart, paths: PartPaths, hasher: Hasher): Promise<void> {
    const actual = hasher.digest()
    if (actual !== part.sha256) {
      await files.remove(paths.partial)
      throw problem(
        "download",
        "part-mismatch",
        `${part.name} has sha256 ${actual}, the manifest names ${part.sha256}`,
        "import again to download it anew; if it persists, report it",
      )
    }
    await files.rename(paths.partial, paths.done)
  }

  /** Every part present and verified, in order; resolves with the joined image's sha256. */
  async function download(
    release: BotEnvironmentImageRelease,
    manifestValue: ImageManifest,
    dir: string,
    progress: ProgressSink,
    signal?: AbortSignal,
  ): Promise<string> {
    const total = manifestValue.image.bytes
    const needed = await bytesNeeded(manifestValue.parts, dir)
    const free = await files.freeBytes(dir)
    if (free < needed) {
      throw problem(
        "download",
        "disk-space",
        `${dir} has ${gib(free)} free, the base image needs ${gib(needed)} more`,
        "free space on that file system, or set stateDir to one with room",
      )
    }
    const whole = { hasher: deps.sha256() }
    let base = 0
    for (const part of manifestValue.parts) {
      signal?.throwIfAborted()
      const paths = { done: `${dir}/${part.name}`, partial: `${dir}/${part.name}.partial` }
      const onBytes = (bytes: number) => progress("download", base + bytes, total)
      if ((await files.size(paths.done)) === part.bytes) {
        const before = whole.hasher.copy()
        const hasher = deps.sha256()
        await hashFile(paths.done, [hasher, whole.hasher], onBytes, signal)
        if (hasher.digest() === part.sha256) {
          base += part.bytes
          continue
        }
        deps.log(`${part.name} does not have the manifest's sha256; downloading it anew`)
        whole.hasher = before
        onBytes(0)
      }
      await files.remove(paths.done)
      await downloadPart(`${release.baseUrl}/${part.name}`, part, paths, whole, onBytes, signal)
      base += part.bytes
    }
    return whole.hasher.digest()
  }

  async function upload(
    manifestValue: ImageManifest,
    dir: string,
    progress: ProgressSink,
    signal?: AbortSignal,
  ): Promise<string> {
    const total = manifestValue.image.bytes
    let sent = 0
    progress("upload", 0, total)
    async function* body(): AsyncIterable<Uint8Array> {
      for (const part of manifestValue.parts) {
        for await (const chunk of files.read(`${dir}/${part.name}`, signal)) {
          sent += chunk.length
          progress("upload", sent, total)
          yield chunk
        }
      }
    }
    return incusStep("upload", "import the image", signal, () =>
      incus.importImage(body(), { timeoutMs: deps.uploadTimeoutMs, signal }),
    )
  }

  /** Delete an image nothing names (one this import made with an unexpected fingerprint). */
  async function dropUnnamed(fingerprint: string, signal?: AbortSignal): Promise<void> {
    const image = await incus.image(fingerprint, signal)
    if (image !== undefined && image.aliases.length === 0)
      await incus.deleteImage(fingerprint, signal)
  }

  async function pointAlias(alias: string, fingerprint: string, signal?: AbortSignal) {
    const old = await incus.alias(alias, signal)
    await incus.setAlias(alias, fingerprint, signal)
    if (old !== undefined && old !== fingerprint) {
      deps.log(`${alias} moved from ${old} to ${fingerprint}`)
      await dropUnnamed(old, signal)
    }
  }
  async function clearOthers(keep: string): Promise<void> {
    for (const name of await files.list(downloadsDir)) {
      if (name !== keep) await files.remove(`${downloadsDir}/${name}`)
    }
  }

  return {
    manifest,
    target: (alias, signal) =>
      incusStep("check", `read the image alias ${alias}`, signal, () => incus.alias(alias, signal)),
    async run(release, manifestValue, alias, progress, signal) {
      const { fingerprint, bytes } = manifestValue.image
      const dir = `${downloadsDir}/${release.manifestSha256}`
      await clearOthers(release.manifestSha256)
      const present = await incusStep("download", "read the project's images", signal, () =>
        incus.image(fingerprint, signal),
      )
      if (present === undefined) {
        await files.mkdir(dir)
        const joined = await download(release, manifestValue, dir, progress, signal)
        if (joined !== fingerprint) {
          await files.remove(dir)
          throw problem(
            "download",
            "image-mismatch",
            `the joined image has sha256 ${joined}, the manifest names ${fingerprint}`,
            "import again to download it anew; if it persists, report it",
          )
        }
        deps.log(`uploading ${manifestValue.image.name} (${gib(bytes)}) to Incus`)
        const imported = await upload(manifestValue, dir, progress, signal)
        if (imported !== fingerprint) {
          await incusStep("upload", "delete the unexpected image", undefined, () =>
            dropUnnamed(imported, undefined),
          )
          throw problem(
            "upload",
            "fingerprint-mismatch",
            `Incus imported the image as ${imported}, the manifest names ${fingerprint}`,
            "import again; if it persists, report it",
          )
        }
      } else deps.log(`the project already has the image ${fingerprint}`)
      progress("alias", 0, 0)
      await incusStep("alias", `point the alias ${alias} at ${fingerprint}`, signal, () =>
        pointAlias(alias, fingerprint, signal),
      )
      await files.remove(dir)
    },
    clearDownloads: () => files.remove(downloadsDir),
  }
}
