/**
 * How bot-core compares what people write (notes' names, searches of past
 * conversations): NFKC, then lower case. A text is folded code point by code
 * point, keeping where each folded unit came from, so a match found in the
 * folded text maps back onto the original.
 */

export const foldName = (name: string) => name.normalize("NFKC").toLowerCase()

export interface FoldedText {
  readonly text: string
  /** For each code unit of `text`, the offset of the original code point it came from. */
  readonly origin: readonly number[]
  /** The original text's length, the end of the last range. */
  readonly length: number
}

export function foldText(original: string): FoldedText {
  let text = ""
  const origin: number[] = []
  let offset = 0
  for (const point of original) {
    const folded = foldName(point)
    text += folded
    for (let unit = 0; unit < folded.length; unit++) origin.push(offset)
    offset += point.length
  }
  return { text, origin, length: original.length }
}

/** The original range of the folded range [start, end). */
export function originalRange(folded: FoldedText, start: number, end: number) {
  const from = folded.origin[start] ?? folded.length
  const to = end >= folded.text.length ? folded.length : (folded.origin[end] ?? folded.length)
  return { start: from, end: to }
}
