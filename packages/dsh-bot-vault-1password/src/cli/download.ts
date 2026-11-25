/** Fetch a file over https into memory, at most `maxBytes`. */
export async function download(
  url: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (new URL(url).protocol !== "https:")
    throw new Error("the 1Password CLI is fetched over https only")
  const response = await fetch(url, { signal, redirect: "follow" })
  if (!response.ok || response.body === null) {
    throw new Error(`the download answered HTTP ${response.status}`)
  }
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (declared > maxBytes) throw new Error("the download is larger than expected")
  const chunks: Uint8Array[] = []
  let length = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error("the download is larger than expected")
    }
    chunks.push(value)
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
