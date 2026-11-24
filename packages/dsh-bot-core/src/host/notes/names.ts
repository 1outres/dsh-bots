/**
 * How names are compared (docs/specs/bot-notes.md §4): NFKC, then lower case,
 * as plain string equality or substring (host/text-fold.ts).
 */

/** Code points, the unit a person counts characters in. */
export const characters = (text: string) => [...text].length

const WORD = /[\p{L}\p{N}]/u
const ASCII_WORD = /[A-Za-z0-9]/u

/**
 * Whether a match of a name at [start, end) of `text` stands on its own: a
 * name starting or ending with a Latin letter or digit must not continue a
 * longer word there ("Tom" in "Tomorrow"). Scripts without spaces match anywhere.
 */
export function standsAlone(text: string, start: number, end: number): boolean {
  const first = text.slice(start, start + 1)
  const last = text.slice(end - 1, end)
  if (ASCII_WORD.test(first) && WORD.test(text.slice(start - 1, start))) return false
  if (ASCII_WORD.test(last) && WORD.test(text.slice(end, end + 1))) return false
  return true
}

/** Group digits by thousands: 3120 → "3,120". */
export const groupDigits = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",")
