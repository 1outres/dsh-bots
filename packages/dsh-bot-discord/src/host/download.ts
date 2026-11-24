/** A fetch of one URL, as far as read here (the global `fetch`). */
export type FetchUrl = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: "error" },
) => Promise<{
  readonly ok: boolean
  readonly status: number
  readonly body: AsyncIterable<Uint8Array> | null
}>

/** The hosts Discord serves message attachments from. */
export const ATTACHMENT_HOSTS: ReadonlySet<string> = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
])

/** Whether a URL is an attachment on Discord's CDN (HTTPS, default port, no credentials). */
export function isAttachmentUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    ATTACHMENT_HOSTS.has(parsed.hostname)
  )
}

/**
 * Read an attachment from Discord's CDN, stopping as soon as it passes
 * `maxBytes` (a declared size is not trusted). Any other URL, and any
 * redirect, is refused.
 */
export async function downloadAttachment(
  fetch: FetchUrl,
  url: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!isAttachmentUrl(url)) throw new Error("the attachment is not on Discord's CDN")
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" })
    if (!response.ok) throw new Error(`Discord answered HTTP ${response.status}`)
    if (response.body === null) throw new Error("Discord sent no content")
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.byteLength
      if (length > maxBytes) throw new Error(`it is larger than ${maxBytes} bytes`)
      chunks.push(chunk)
    }
    const data = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    return data
  } finally {
    signal.removeEventListener("abort", abort)
    controller.abort()
  }
}
