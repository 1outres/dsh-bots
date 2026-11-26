export interface SpaceBlobIo {
  read(hash: string): ReadableStream<Uint8Array>
  write(hash: string, bytes: Uint8Array): Promise<void>
  delete(hash: string): Promise<void>
  list(): Promise<readonly string[]>
}

export interface SpaceBlobs {
  put(bytes: Uint8Array): Promise<string>
  hashOf(bytes: Uint8Array): string
  open(hash: string): ReadableStream<Uint8Array>
  collect(referenced: ReadonlySet<string>): Promise<number>
}

export interface SpaceBlobsDeps {
  readonly io: SpaceBlobIo
  sha256(bytes: Uint8Array): string
}

const BLOB = /^[0-9a-f]{64}$/

export async function openSpaceBlobs(deps: SpaceBlobsDeps): Promise<SpaceBlobs> {
  const known = new Set((await deps.io.list()).filter((hash) => BLOB.test(hash)))
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  return {
    hashOf: (bytes) => deps.sha256(bytes),
    put(bytes) {
      const hash = deps.sha256(bytes)
      return serial(async () => {
        if (!known.has(hash)) {
          await deps.io.write(hash, bytes)
          known.add(hash)
        }
        return hash
      })
    },
    open(hash) {
      if (!BLOB.test(hash)) throw new Error(`"${hash}" is not a blob hash`)
      return deps.io.read(hash)
    },
    collect: (referenced) =>
      serial(async () => {
        let removed = 0
        for (const hash of [...known]) {
          if (referenced.has(hash)) continue
          await deps.io.delete(hash)
          known.delete(hash)
          removed += 1
        }
        return removed
      }),
  }
}
