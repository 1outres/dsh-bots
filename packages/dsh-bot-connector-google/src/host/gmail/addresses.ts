/** One mailbox of a header: an optional display name and an address. */
export interface Mailbox {
  readonly name?: string
  readonly address: string
}

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/**
 * A mailbox written by the bot: `name <address>` or `address`. Line breaks
 * and control characters are refused, so no argument can add a header.
 * @throws naming what is wrong.
 */
export function parseMailbox(input: string): Mailbox {
  if (CONTROL.test(input))
    throw new Error(`"${input.replace(CONTROL, "?")}" has a line break or control character`)
  const text = input.trim()
  const angled = /^(.*)<([^<>]+)>$/.exec(text)
  const address = (angled?.[2] ?? text).trim()
  if (!ADDRESS.test(address)) throw new Error(`"${text}" is not an email address`)
  const name = angled?.[1]
    ?.trim()
    .replace(/^"(.*)"$/, "$1")
    .trim()
  return name === undefined || name === "" ? { address } : { name, address }
}

export function parseMailboxes(inputs: readonly string[] | undefined, what: string): Mailbox[] {
  const list = (inputs ?? []).map((input) => {
    try {
      return parseMailbox(input)
    } catch (error) {
      throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  return list
}

/** A mailbox as people read it. */
export function showMailbox(mailbox: Mailbox): string {
  return mailbox.name === undefined ? mailbox.address : `${mailbox.name} <${mailbox.address}>`
}

/** Split an address header (From, To, Cc) into mailboxes, as received (lenient: outside data). */
export function readMailboxes(header: string | undefined): Mailbox[] {
  if (header === undefined || header.trim() === "") return []
  const parts: string[] = []
  let current = ""
  let quoted = false
  let angled = false
  for (const char of header) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === "<") angled = true
    if (!quoted && char === ">") angled = false
    if (char === "," && !quoted && !angled) {
      parts.push(current)
      current = ""
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.flatMap((part) => {
    try {
      return [parseMailbox(part.replace(/[\r\n]+/g, " "))]
    } catch {
      return []
    }
  })
}

export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
