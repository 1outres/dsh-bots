import type { MainInputFailure } from "../../shared/main-input"
import type { MainInputClient } from "./client"

export interface UploadSource {
  readonly name: string
  readonly type: string
  readonly size: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export type UploadOutcome =
  | { readonly ok: true; readonly attachmentId: string }
  | { readonly ok: false; readonly failure: MainInputFailure }

const BASE64_SLICE = 0x8000

export function base64Of(bytes: Uint8Array): string {
  let binary = ""
  for (let at = 0; at < bytes.byteLength; at += BASE64_SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_SLICE))
  }
  return btoa(binary)
}

export async function uploadAttachment(
  client: Pick<MainInputClient, "stage" | "append" | "discard">,
  request: {
    readonly botId: string
    readonly draft: string
    readonly file: UploadSource
    readonly chunkBytes: number
    readonly signal: AbortSignal
    progress(sent: number): void
  },
): Promise<UploadOutcome> {
  const { botId, file, chunkBytes, signal } = request
  const staged = await client.stage(botId, {
    draft: request.draft,
    name: file.name,
    ...(file.type === "" ? {} : { mediaType: file.type }),
    bytes: file.size,
  })
  if (!staged.staged) return { ok: false, failure: staged.failure }
  const { attachmentId } = staged
  try {
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
      signal.throwIfAborted()
      const end = Math.min(offset + chunkBytes, file.size)
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      signal.throwIfAborted()
      const appended = await client.append(botId, attachmentId, offset, base64Of(chunk))
      if (!appended.appended) {
        await client.discard(botId, attachmentId)
        return { ok: false, failure: appended.failure }
      }
      request.progress(appended.received)
    }
  } catch (error) {
    await client.discard(botId, attachmentId)
    throw error
  }
  return { ok: true, attachmentId }
}
