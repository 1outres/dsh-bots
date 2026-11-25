/**
 * Other readings of a text the leak guard also looks in (docs/specs/bot-vaults.md
 * §7.1): the same text with one kind of escaping undone (JSON \\uXXXX and
 * short escapes, %xx in either case and +, HTML character references) or
 * with its whitespace removed (wrapped base64 or hex). A secret found only in
 * a reading withholds the whole text, as its place in the text is not known.
 */

const JSON_ESCAPE = /\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g
const SHORT: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
}

function jsonUnescaped(text: string): string {
  return text.replace(JSON_ESCAPE, (_match, code: string | undefined, short: string | undefined) =>
    code === undefined
      ? (SHORT[short ?? ""] ?? "")
      : String.fromCharCode(Number.parseInt(code, 16)),
  )
}

function percentDecoded(text: string, plus: boolean): string {
  const source = plus ? text.replace(/\+/g, " ") : text
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string
    const hex = source.slice(index + 1, index + 3)
    if (char === "%" && /^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(...encoder.encode(char))
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
}

function htmlDecoded(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g,
    (match, dec, hex, name) => {
      const code =
        dec !== undefined
          ? Number.parseInt(dec, 10)
          : hex !== undefined
            ? Number.parseInt(hex, 16)
            : undefined
      if (code !== undefined) return code <= 0x10ffff ? String.fromCodePoint(code) : match
      return NAMED[(name as string).toLowerCase()] ?? match
    },
  )
}

const stripped = (text: string) => text.replace(/\s+/g, "")

/** The readings of a text that differ from it. */
export function readingsOf(text: string): readonly string[] {
  const readings = new Set<string>()
  if (text.includes("\\")) readings.add(jsonUnescaped(text))
  if (text.includes("%")) {
    readings.add(percentDecoded(text, false))
    readings.add(percentDecoded(text, true))
  } else if (text.includes("+")) {
    readings.add(percentDecoded(text, true))
  }
  if (text.includes("&")) readings.add(htmlDecoded(text))
  if (/\s/.test(text)) readings.add(stripped(text))
  readings.delete(text)
  return [...readings]
}
