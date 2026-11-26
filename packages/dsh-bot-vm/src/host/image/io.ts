export interface Hasher {
  update(bytes: Uint8Array): void
  copy(): Hasher
  digest(): string
}

export interface FileAppender {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface ImageFiles {
  readText(path: string): Promise<string | undefined>
  writeText(path: string, text: string): Promise<void>
  size(path: string): Promise<number | undefined>
  read(path: string, signal?: AbortSignal): AsyncIterable<Uint8Array>
  append(path: string, truncate: boolean): Promise<FileAppender>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  list(path: string): Promise<readonly string[]>
  freeBytes(path: string): Promise<number>
}

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
  get(url: string, offset: number, signal?: AbortSignal): Promise<HttpBody>
}
