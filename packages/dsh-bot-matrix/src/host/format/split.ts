export const MESSAGE_LIMIT = 16_000

const FENCE = /^\s*(`{3,}|~{3,})/

function openFence(text: string, opened: string | undefined): string | undefined {
  let current = opened
  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1]
    if (marker === undefined) continue
    if (current === undefined) current = marker
    else if (marker[0] === current[0] && marker.length >= current.length) current = undefined
  }
  return current
}

function cutPoint(text: string, limit: number): number {
  const window = text.slice(0, limit + 1)
  const floor = Math.floor(limit / 2)
  for (const separator of ["\n\n", "\n", " "]) {
    const at = window.lastIndexOf(separator)
    if (at >= floor) return at
  }
  const code = text.charCodeAt(limit - 1)
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit
}

export function splitMarkdown(text: string, limit = MESSAGE_LIMIT): string[] {
  if (limit < 64) throw new Error("a message limit below 64 cannot hold a code fence")
  const chunks: string[] = []
  let rest = text.trim()
  let reopen: string | undefined
  while (rest.length > 0) {
    const prefix = reopen === undefined ? "" : `${reopen}\n`
    let budget = limit - prefix.length
    let at = rest.length
    let body = rest
    let open: string | undefined
    for (;;) {
      at = rest.length <= budget ? rest.length : cutPoint(rest, budget)
      body = rest.slice(0, at).replace(/\s+$/, "")
      open = openFence(body, reopen)
      const close = open === undefined ? "" : `\n${open}`
      if (prefix.length + body.length + close.length <= limit) {
        chunks.push(prefix + body + close)
        break
      }
      budget = Math.min(at, budget) - close.length
    }
    reopen = open
    rest = rest
      .slice(at)
      .replace(/^\s*\n/, "")
      .replace(/^ /, "")
  }
  return chunks.filter((chunk) => chunk.trim().length > 0)
}
