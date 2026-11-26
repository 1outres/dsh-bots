export const foldName = (name: string) => name.normalize("NFKC").toLowerCase()

export interface FoldedText {
  readonly text: string
  readonly origin: readonly number[]
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

export function originalRange(folded: FoldedText, start: number, end: number) {
  const from = folded.origin[start] ?? folded.length
  const to = end >= folded.text.length ? folded.length : (folded.origin[end] ?? folded.length)
  return { start: from, end: to }
}
