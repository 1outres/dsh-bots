import type { Range } from "./matching"

export function addedRanges(before: string, after: string): readonly Range[] {
  if (before === "") return after === "" ? [] : [{ start: 0, end: after.length }]
  const old = before.split("\n")
  const next = after.split("\n")
  const lengths: number[][] = Array.from({ length: old.length + 1 }, () =>
    new Array<number>(next.length + 1).fill(0),
  )
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      const row = lengths[i] as number[]
      row[j] =
        old[i] === next[j]
          ? ((lengths[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lengths[i + 1] as number[])[j] as number, row[j + 1] as number)
    }
  }
  const offsets: number[] = []
  let offset = 0
  for (const line of next) {
    offsets.push(offset)
    offset += line.length + 1
  }
  const ranges: Range[] = []
  let removed: string[] = []
  let i = 0
  let j = 0
  const addLine = (index: number) => {
    const line = next[index] as string
    const replaced = removed.shift()
    let start = 0
    let end = line.length
    if (replaced !== undefined) {
      while (start < end && start < replaced.length && line[start] === replaced[start]) start += 1
      let tail = replaced.length
      while (end > start && tail > start && line[end - 1] === replaced[tail - 1]) {
        end -= 1
        tail -= 1
      }
    }
    if (end > start)
      ranges.push({
        start: (offsets[index] as number) + start,
        end: (offsets[index] as number) + end,
      })
  }
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) {
      removed = []
      i += 1
      j += 1
    } else if (
      i < old.length &&
      (j === next.length ||
        ((lengths[i + 1] as number[])[j] as number) >= ((lengths[i] as number[])[j + 1] as number))
    ) {
      removed.push(old[i] as string)
      i += 1
    } else {
      addLine(j)
      j += 1
    }
  }
  return ranges
}
