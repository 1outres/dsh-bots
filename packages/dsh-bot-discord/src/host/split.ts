/** Discord's limit on one message's content. */
export const MESSAGE_LIMIT = 2000

const FENCE = /^\s*(`{3,}|~{3,})/
/** A longer opening line is reopened as its bare fence, so the next message keeps its room. */
const MAX_REOPEN = 32

/** The fence a chunk leaves open, if any: the line that opened it. */
function openFence(text: string, opened: string | undefined): string | undefined {
  let current = opened
  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1]
    if (marker === undefined) continue
    if (current === undefined) current = line.trim()
    else if (marker[0] === current[0] && marker.length >= (FENCE.exec(current)?.[1]?.length ?? 3)) {
      current = undefined
    }
  }
  return current
}

/** Where to cut `text` at most `limit` units in: a paragraph, a line, a space, else anywhere but inside a surrogate pair. */
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

/**
 * Split a reply into Discord messages of at most `limit` UTF-16 units
 * (Discord counts no more than that), cutting at paragraph, line or word
 * boundaries when one lies in the second half of the window. A code block
 * cut in two is closed at the end of one message and opened again (same
 * fence and language) at the start of the next.
 */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  let reopen: string | undefined
  if (limit < 64) throw new Error("a message limit below 64 cannot hold a code fence")
  while (rest.length > 0) {
    const prefix = reopen === undefined ? "" : `${reopen}\n`
    let budget = limit - prefix.length
    let at = rest.length
    let body = rest
    let open: string | undefined
    let fence = ""
    for (;;) {
      at = rest.length <= budget ? rest.length : cutPoint(rest, budget)
      body = rest.slice(0, at).replace(/\s+$/, "")
      open = openFence(body, reopen)
      fence = open === undefined ? "" : `\n${FENCE.exec(open)?.[1]}`
      if (prefix.length + body.length + fence.length <= limit) break
      budget = Math.min(at, budget) - fence.length
    }
    chunks.push(prefix + body + fence)
    reopen = open === undefined || open.length <= MAX_REOPEN ? open : FENCE.exec(open)?.[1]
    rest = rest
      .slice(at)
      .replace(/^\s*\n/, "")
      .replace(/^ /, "")
  }
  return chunks.filter((chunk) => chunk.trim().length > 0)
}
