/** What the image import needs of the Host (src/node/image-io.ts implements it). */

export interface Hasher {
  update(bytes: Uint8Array): void
  /** An independent hasher with the same state. */
  copy(): Hasher
  /** Lower-case hex. */
  digest(): string
}

export interface FileAppender {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

/** Files under the image directory. Paths are absolute. */
export interface ImageFiles {
  /** Contents, or undefined when the file does not exist. */
  readText(path: string): Promise<string | undefined>
  /** Replace a file atomically (mode 0600). */
  writeText(path: string, text: string): Promise<void>
  /** Size in bytes, or undefined when the file does not exist. */
  size(path: string): Promise<number | undefined>
  read(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array>
  /** Open a file for appending, created when missing; `truncate` empties it first. */
  append(path: string, truncate: boolean): Promise<FileAppender>
  rename(from: string, to: string): Promise<void>
  /** Remove a file or a directory tree; missing is fine. */
  remove(path: string): Promise<void>
  /** Create a directory and its parents (mode 0700). */
  mkdir(path: string): Promise<void>
  /** Entry names of a directory; none when it does not exist. */
  list(path: string): Promise<readonly string[]>
  /** Bytes an unprivileged user may still write on the directory's file system. */
  freeBytes(path: string): Promise<number>
}

/**
 * A GET from byte `offset`: `range` when the server sent that range of a
 * `total`-byte resource, `whole` when it sent the resource from its start.
 */
export type HttpBody =
  | {
      readonly kind: "range"
      readonly start: number
      readonly total: number
      readonly body: AsyncIterable<Uint8Array>
    }
  | {
      readonly kind: "whole"
      readonly total: number | undefined
      readonly body: AsyncIterable<Uint8Array>
    }

export interface ImageHttp {
  /** Rejects on a network failure, an HTTP error status or a stalled body, with the reason. */
  get(url: string, offset: number, signal?: AbortSignal): Promise<HttpBody>
}
