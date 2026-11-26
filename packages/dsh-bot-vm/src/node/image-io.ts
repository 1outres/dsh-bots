/**
 * The image import's Host side over Node (src/host/image/io.ts): files under
 * the image directory, sha256, and HTTP GETs with a byte range whose body
 * fails once no byte arrived for `stallMs`.
 */
import { createHash, type Hash } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises"
import type { FileAppender, Hasher, HttpBody, ImageFiles, ImageHttp } from "../host/image/io"

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"

export const nodeImageFiles: ImageFiles = {
  async readText(path) {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  },
  async writeText(path, text) {
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, text, { mode: 0o600 })
    await rename(temporary, path)
  },
  async size(path) {
    try {
      return (await stat(path)).size
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  },
  async *read(path, signal) {
    for await (const chunk of createReadStream(path, { signal, highWaterMark: 1024 * 1024 })) {
      yield chunk as Buffer
    }
  },
  async append(path, truncate): Promise<FileAppender> {
    const handle = await open(path, truncate ? "w" : "a", 0o600)
    return {
      async write(bytes) {
        let at = 0
        while (at < bytes.length) at += (await handle.write(bytes, at)).bytesWritten
      },
      close: () => handle.close(),
    }
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { recursive: true, force: true }),
  async mkdir(path) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    await chmod(path, 0o700)
  },
  async list(path) {
    try {
      return await readdir(path)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  },
  async freeBytes(path) {
    const fs = await statfs(path)
    return fs.bavail * fs.bsize
  },
}

function hasherOf(hash: Hash): Hasher {
  return {
    update: (bytes) => {
      hash.update(bytes)
    },
    copy: () => hasherOf(hash.copy()),
    digest: () => hash.digest("hex"),
  }
}

export const sha256 = (): Hasher => hasherOf(createHash("sha256"))

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/

export function nodeImageHttp(options: {
  readonly stallMs: number
  readonly userAgent: string
}): ImageHttp {
  return {
    async get(url, offset, signal): Promise<HttpBody> {
      const stalled = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(
          () => stalled.abort(new Error(`no data for ${options.stallMs} ms`)),
          options.stallMs,
        )
        timer.unref()
      }
      arm()
      const combined =
        signal === undefined ? stalled.signal : AbortSignal.any([signal, stalled.signal])
      let response: Response
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": options.userAgent,
            ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}),
          },
          redirect: "follow",
          signal: combined,
        })
      } catch (error) {
        clearTimeout(timer)
        if (stalled.signal.aborted && !signal?.aborted) throw stalled.signal.reason
        throw error
      }
      if ((response.status !== 200 && response.status !== 206) || response.body === null) {
        clearTimeout(timer)
        await response.body?.cancel()
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }
      const stream = response.body
      async function* body(): AsyncIterable<Uint8Array> {
        try {
          for await (const chunk of stream) {
            arm()
            yield chunk
          }
        } catch (error) {
          if (stalled.signal.aborted && !signal?.aborted) throw stalled.signal.reason
          throw error
        } finally {
          clearTimeout(timer)
        }
      }
      if (response.status === 206) {
        const range = CONTENT_RANGE.exec(response.headers.get("content-range") ?? "")
        if (range === null) {
          clearTimeout(timer)
          await stream.cancel()
          throw new Error("HTTP 206 without a byte range")
        }
        return { kind: "range", start: Number(range[1]), total: Number(range[3]), body: body() }
      }
      const length = response.headers.get("content-length")
      return { kind: "whole", total: length === null ? undefined : Number(length), body: body() }
    },
  }
}
